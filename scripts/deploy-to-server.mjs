// 一键部署到内网服务器 10.2.248.6（本平台固定部署机，与数据挖掘 10.2.248.34 分开）
//
// 用法（项目根目录执行）：
//   node scripts/deploy-to-server.mjs --user algo --password 123        # 完整部署
//   node scripts/deploy-to-server.mjs --user algo --password 123 --check-only   # 只探测环境，不改动
//   node scripts/deploy-to-server.mjs --dry-run                        # 本地构建打包，打印远端步骤
//   node scripts/deploy-to-server.mjs --user algo --password 123 --force-seed   # 覆盖服务器账号（慎用）
//
// 密码也可以走环境变量，避免留在命令历史里：DEPLOY_SSH_PASSWORD=xxx
//
// 隔离策略（与数据挖掘 10.2.248.34 是两台机器，天然隔离；同机资源也做礼让）：
//   机器      10.2.248.6              （数据挖掘在 10.2.248.34，两台机器）
//   目录      /opt/data_label
//   服务      data_label.service
//   系统账号  data_label               （专用，不复用 www-data）
//   数据库    data_label + 专用账号    （不与 data_mining 共库）
//   端口      3001                     （data_mining 用 8009）
//   Node      自带运行时放 /opt/data_label/runtime，不装系统级 Node，不动别人的环境
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './lib/ssh.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const CFG = {
  host: arg('host', '10.2.248.6'),
  user: arg('user', 'algo'),
  password: arg('password', process.env.DEPLOY_SSH_PASSWORD || ''),
  key: arg('key', path.join(os.homedir(), '.ssh', 'id_ed25519')),
  port: Number(arg('port', '3001')),
  dir: arg('dir', '/opt/data_label'),
  service: arg('service', 'data_label'),
  runUser: arg('run-user', 'data_label'),
  dbName: arg('db', 'data_label'),
  dbUser: arg('db-user', 'data_label'),
  nodeVersion: arg('node-version', 'v20.18.1'),
  skipBuild: flag('skip-build'),
  skipTests: flag('skip-tests'),
  forceSeed: flag('force-seed'),
  noRestart: flag('no-restart'),
  checkOnly: flag('check-only'),
  dryRun: flag('dry-run')
}
const TARGET = `${CFG.user}@${CFG.host}`
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const step = (n, text) => console.log(`\n[${n}] ${text}`)
const info = (t) => console.log(`    ${t}`)
const die = (t) => { console.error(`\n✖ ${t}`); process.exit(1) }
const tail = (s, n = 25) => s.split('\n').filter(Boolean).slice(-n).map((l) => `    ${l}`).join('\n')

function local (cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) die(`本地命令失败：${cmd} ${args.join(' ')}`)
  return r
}

// ---------- 1) 本地校验与构建 ----------
if (!CFG.checkOnly) {
  step('1/6', '本地校验与构建')
  for (const f of ['package.json', 'server/index.js', 'deploy/data-label.service']) {
    if (!fs.existsSync(path.join(ROOT, f))) die(`缺少文件 ${f}，请在项目根目录执行`)
  }
  if (!fs.existsSync(path.join(ROOT, 'deploy/seed.json'))) {
    info('未找到 deploy/seed.json，正在从本地库导出账号与名册种子…')
    local(process.execPath, ['scripts/export-seed.mjs'], { cwd: ROOT })
  }
  if (!CFG.skipTests) {
    info('跑单测（node --test）…')
    local(process.execPath, ['--test'], { cwd: ROOT })
  }
  if (!CFG.skipBuild) {
    info('构建前端 dist/ …')
    // Windows 下 npm 退出时偶发 libuv 断言（构建其实已完成），所以以产物是否生成为准
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, stdio: 'inherit' })
    if (build.status !== 0 && !fs.existsSync(path.join(ROOT, 'dist/index.html'))) die('本地构建失败（未生成 dist/index.html）')
    if (build.status !== 0) info('构建进程退出码非 0（Windows 偶发断言），产物已生成，继续')
  }
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) die('dist/index.html 不存在，构建未生效')
}

// ---------- 2) 打包 ----------
let tarballRel = ''
let stamp = ''
if (!CFG.checkOnly) {
  step('2/6', '打包部署产物')
  fs.mkdirSync(path.join(ROOT, 'deploy', '.build'), { recursive: true })
  stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  tarballRel = `deploy/.build/data-label-${stamp}.tar.gz`
  const tarball = path.join(ROOT, tarballRel)
  const INCLUDE = ['dist', 'server', 'scripts', 'deploy', 'package.json', 'package-lock.json', 'README.md', 'AGENTS.md']
  local('tar', [
    'czf', tarballRel,
    '--exclude=deploy/.build',
    '--exclude=server/data',
    '--exclude=node_modules',
    '--exclude=.env',
    '--exclude=uploads',
    ...INCLUDE
  ], { cwd: ROOT })
  info(`产物 ${tarballRel}（${(fs.statSync(tarball).size / 1024 / 1024).toFixed(2)} MB）`)
  info(`包含：${INCLUDE.join('、')}（不含 .env / node_modules / uploads / server/data / tests）`)

  if (CFG.dryRun) {
    step('dry-run', '以下是将在服务器执行的步骤（本次不连接服务器）')
    info(`sftp 上传 ${path.basename(tarball)} → /tmp/`)
    info(`创建专用系统账号 ${CFG.runUser} → ${CFG.dir}（与 /opt/ad_mining 隔离）`)
    info(`自带 Node 运行时 → ${CFG.dir}/runtime（不装系统 Node）`)
    info(`备份已有 ${CFG.dir} → /root/${CFG.service}-backup-*.tar.gz`)
    info(`解包 → 用自带 npm 执行 npm ci --omit=dev`)
    info(`首次部署生成 .env（openssl 随机 JWT_SECRET / DB 密码）→ 建库 ${CFG.dbName} + 账号 ${CFG.dbUser}`)
    info(`导入账号名册：node scripts/seed-db.mjs${CFG.forceSeed ? ' --force' : ''}`)
    info(`安装 systemd 单元 ${CFG.service}.service → 重启 → 健康检查 :${CFG.port}/api/health`)
    process.exit(0)
  }
}

// ---------- 3) 连接与环境预检 ----------
step('3/6', `连接与预检 ${TARGET}`)
let ssh
try {
  ssh = await connect({ host: CFG.host, port: 22, user: CFG.user, password: CFG.password, keyPath: CFG.key })
} catch (e) {
  const msg = String(e.message || e)
  let why = `连不上 ${TARGET}：${msg}`
  if (/timed out|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    why = `连不上 ${TARGET}：本机当前网络到不了这台服务器。\n` +
      '    服务器在内网（10.2.248.x），需要接入公司内网或让零信任客户端（CAZTP-Agent）真正连上。\n' +
      `    自检：ping ${CFG.host}；ssh ${CFG.user}@${CFG.host}`
  } else if (/authentication|All configured authentication methods failed/i.test(msg)) {
    why = `${TARGET} 认证失败：用户名或密码不对（当前方式：${CFG.password ? '密码' : '密钥 ' + CFG.key}）`
  }
  die(why)
}
info(`已连接（${CFG.password ? '密码认证' : '密钥认证'}）`)

const probe = await ssh.exec(`
echo "主机: $(hostname) / $(uname -m)"
echo "系统: $(. /etc/os-release 2>/dev/null; echo $PRETTY_NAME)"
echo "身份: $(id -un) uid=$(id -u)"
echo "sudo: $(sudo -n true 2>/dev/null && echo 免密可用 || echo 需要密码)"
echo "自带node: $(command -v node >/dev/null && node -v || echo 未安装)"
echo "systemctl: $(command -v systemctl >/dev/null && echo 可用 || echo 不可用)"
echo "MySQL: $(command -v mysql || command -v mariadb || echo 未安装)"
echo "mysql进程: $(pgrep -c mysqld 2>/dev/null || echo 0) 个"
echo "数据挖掘服务: $(systemctl is-active ad_mining 2>/dev/null || echo 未找到)"
echo "端口: $(ss -lntu 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$' | sort -un | tr '\\n' ' ')"
echo "目标端口 ${CFG.port}: $(ss -lnt 2>/dev/null | grep -c ':${CFG.port} ' || echo 0) 个监听"
echo "目标目录: $( [ -d ${CFG.dir} ] && echo 已存在 || echo 不存在 )"
echo "磁盘 ${path.posix.dirname(CFG.dir)}: $(df -h ${path.posix.dirname(CFG.dir)} 2>/dev/null | tail -1 | awk '{print $4" 可用"}')"
echo "外网: $(curl -s -o /dev/null -w '%{http_code}' -m 8 https://nodejs.org/ 2>/dev/null || echo 不可达)"
`)
console.log(tail(probe.out, 20))
if (probe.code !== 0) die('预检命令执行失败')

const hasSystemctl = /systemctl: 可用/.test(probe.out)
const hasMysql = /MySQL: (?!未安装)/.test(probe.out) && !/MySQL: 未安装/.test(probe.out)
const netOk = /外网: 200|外网: 30\d/.test(probe.out)

if (CFG.checkOnly) {
  console.log('\n（--check-only：预检完成，未做任何改动）')
  ssh.close()
  process.exit(0)
}
if (!hasSystemctl) die('服务器没有 systemctl，本方案依赖 systemd 托管服务，请改用其他方式（如 Docker）。')
if (!hasMysql) {
  die(`服务器没有 MySQL/MariaDB 客户端。两种选择：\n` +
    `  A. 让运维在服务器上装 MySQL：apt-get install -y mysql-server && systemctl enable --now mysql\n` +
    `  B. 如果用 Docker 部署，告诉我，我改一份 docker-compose（自带 MySQL，与宿主机更隔离）\n` +
    `  注意：库名用独立的 ${CFG.dbName}，不会动 data_mining 的数据。`)
}
if (!netOk) info('提示：服务器拉不到 nodejs.org，自带 Node 运行时可能需要走内网镜像（见部署说明）')

// ---------- 4) 上传 ----------
step('4/6', '上传部署产物')
const remoteTar = `/tmp/data-label-${stamp}.tar.gz`
await ssh.upload(path.join(ROOT, tarballRel), remoteTar)
info(`已上传 → ${remoteTar}`)

// ---------- 5) 远端安装 ----------
step('5/6', '远端安装与配置（隔离环境）')
const install = await ssh.asRoot(`
set -euo pipefail
DIR="${CFG.dir}"
PORT="${CFG.port}"
SVC="${CFG.service}"
RUN_USER="${CFG.runUser}"
DB_NAME="${CFG.dbName}"
DB_USER="${CFG.dbUser}"
NODE_VER="${CFG.nodeVersion}"
TARBALL="${remoteTar}"

# 1) 专用系统账号（不带家目录、不可登录），与 data_mining 的账号区分开
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER" 2>/dev/null \\
    || useradd -r -M -s /sbin/nologin "$RUN_USER"
  echo "已创建专用系统账号 $RUN_USER"
else
  echo "专用系统账号 $RUN_USER 已存在"
fi

mkdir -p "$DIR/uploads/bills"

# 2) 备份已有部署
if [ -d "$DIR/server" ]; then
  BK="/root/\${SVC}-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar czf "$BK" -C "$DIR" --exclude=node_modules --exclude=runtime . 2>/dev/null || true
  echo "已备份现有部署 → $BK"
fi

# 3) 自带 Node 运行时（放安装目录内，不写系统环境、不影响其他服务）
ARCH=$(uname -m); case "$ARCH" in x86_64) NARCH=x64;; aarch64) NARCH=arm64;; *) NARCH=x64;; esac
if [ ! -x "$DIR/runtime/node/bin/node" ]; then
  if command -v node >/dev/null 2>&1 && [ "$(node -v | cut -c2- | cut -d. -f1)" -ge 20 ]; then
    echo "服务器已有 Node $(node -v)，直接用系统 Node"
  else
    echo "下载自带 Node $NODE_VER ($NARCH) 到 $DIR/runtime …"
    mkdir -p "$DIR/runtime"
    TMPN=$(mktemp -d)
    URL="https://nodejs.org/dist/\${NODE_VER}/node-\${NODE_VER}-linux-\${NARCH}.tar.xz"
    if curl -fsSL -m 300 "$URL" -o "$TMPN/node.tar.xz" || wget -q -T 300 "$URL" -O "$TMPN/node.tar.xz"; then
      tar xJf "$TMPN/node.tar.xz" -C "$DIR/runtime"
      mv "$DIR/runtime/node-\${NODE_VER}-linux-\${NARCH}" "$DIR/runtime/node"
      rm -rf "$TMPN"
      "$DIR/runtime/node/bin/node" -v
      echo "自带 Node 就绪：$DIR/runtime/node/bin/node"
    else
      echo "!! 下载 Node 失败：服务器可能无法访问 nodejs.org"
      echo "   可改用内网镜像，或让运维 apt 安装 Node 20 后重新执行（脚本会自动改用系统 Node）"
      exit 1
    fi
  fi
fi
NODE_BIN=$(command -v node 2>/dev/null || echo "$DIR/runtime/node/bin/node")
[ -x "$DIR/runtime/node/bin/node" ] && NODE_BIN="$DIR/runtime/node/bin/node"
# 自带 Node 必须进 PATH：npm 是 #!/usr/bin/env node 的脚本，否则会报 "env: 'node': No such file or directory"
export PATH="$(dirname "$NODE_BIN"):$PATH"
NPM_BIN=$(dirname "$NODE_BIN")/npm
echo "使用 Node: $NODE_BIN（$($NODE_BIN -v)）"

# 4) 解包代码（不动 .env / uploads / runtime）
tar xzf "$TARBALL" -C "$DIR"
echo "代码已解包到 $DIR"

# 5) 生产依赖（只装运行时依赖，devDependencies 不装）
cd "$DIR"
echo "安装生产依赖…"
if [ -x "$NPM_BIN" ]; then
  "$NPM_BIN" ci --omit=dev --no-audit --no-fund || "$NPM_BIN" install --omit=dev --no-audit --no-fund
else
  npm ci --omit=dev --no-audit --no-fund
fi

# 6) 首次部署：生成 .env（密钥在服务器本地生成）+ 建独立库
if [ ! -f "$DIR/.env" ]; then
  DB_PASS=$(openssl rand -hex 12)
  JWT=$(openssl rand -hex 32)
  cat > "$DIR/.env" <<ENVEOF
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=\${DB_USER}
DB_PASSWORD=\${DB_PASS}
DB_NAME=\${DB_NAME}
API_HOST=0.0.0.0
API_PORT=\${PORT}
JWT_SECRET=\${JWT}
TOKEN_TTL_SECONDS=28800
CORS_ORIGIN=http://${CFG.host},http://${CFG.host}:\${PORT}
MAX_BODY_BYTES=52428800
RATE_LIMIT_ENABLED=1
RATE_LIMIT_AUTH_PER_MIN=120
RATE_LIMIT_API_PER_MIN=3000
ENVEOF
  chmod 600 "$DIR/.env"
  echo "已生成 $DIR/.env（权限 600）"

  sed "s|REPLACE_WITH_STRONG_PASSWORD|\${DB_PASS}|" "$DIR/deploy/init-db.sql" > /tmp/data-label-init.sql
  MYSQL_CMD=""
  if mysql --protocol=socket -uroot -e "SELECT 1" >/dev/null 2>&1; then MYSQL_CMD="mysql --protocol=socket -uroot";
  elif mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then MYSQL_CMD="mysql -uroot";
  fi
  if [ -n "$MYSQL_CMD" ]; then
    $MYSQL_CMD < /tmp/data-label-init.sql
    rm -f /tmp/data-label-init.sql
    echo "已建独立库 $DB_NAME 与账号 $DB_USER（表结构由服务启动时自动创建）"
  else
    echo "!! 无法免密进入 MySQL：请手工执行（把密码换成 $DIR/.env 里的 DB_PASSWORD）"
    echo "   mysql -uroot -p < /tmp/data-label-init.sql"
    exit 1
  fi
else
  echo "沿用已有 $DIR/.env"
fi

# 7) 导入账号与供应商名册（默认只填空集合，不覆盖已改账号）
echo "导入账号名册…"
"$NODE_BIN" scripts/seed-db.mjs ${CFG.forceSeed ? '--force' : ''} || true

# 8) 目录属主与 systemd 单元
chown -R "$RUN_USER:$RUN_USER" "$DIR"
chmod 600 "$DIR/.env"

# 每日 MySQL 备份（保留 14 天）
if [ -f "$DIR/deploy/backup-db.sh" ]; then
  chmod 755 "$DIR/deploy/backup-db.sh"
  printf '# Maxieye 数据协作平台：MySQL 每日备份（保留 14 天）
30 2 * * * root BACKUP_DIR=/root/backup KEEP_DAYS=14 %s/deploy/backup-db.sh >> /var/log/data-label-backup.log 2>&1
' "$DIR" > /etc/cron.d/data-label-backup
  chmod 644 /etc/cron.d/data-label-backup
  echo "已安装每日备份定时任务 /etc/cron.d/data-label-backup"
fi

sed -e "s|/opt/data_label|$DIR|g" \\
    -e "s|/usr/bin/node|$NODE_BIN|g" \\
    -e "s|User=data_label|User=$RUN_USER|" \\
    -e "s|Group=data_label|Group=$RUN_USER|" \\
    "$DIR/deploy/data-label.service" > "/etc/systemd/system/\${SVC}.service"
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1 || true
echo "已安装 /etc/systemd/system/\${SVC}.service"

# nginx 反向代理（让地址不带端口）：服务器装了 nginx 才同步配置
if command -v nginx >/dev/null 2>&1 && [ -f "$DIR/deploy/nginx-data-label.conf" ]; then
  if [ ! -f /etc/nginx/sites-available/data-label ] || ! diff -q "$DIR/deploy/nginx-data-label.conf" /etc/nginx/sites-available/data-label >/dev/null 2>&1; then
    install -m 644 "$DIR/deploy/nginx-data-label.conf" /etc/nginx/sites-available/data-label
    ln -sf /etc/nginx/sites-available/data-label /etc/nginx/sites-enabled/data-label
    [ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default
    nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "已同步 nginx 站点配置（http://${CFG.host}/）"
  else
    echo "nginx 站点配置无变化"
  fi
fi
`)
console.log(tail(install.out, 30))
if (install.code !== 0) die('远端安装失败（详见上面输出）')

// ---------- 6) 重启与健康检查 ----------
if (!CFG.noRestart) {
  step('6/6', '重启服务与健康检查')
  const result = await ssh.asRoot(`
set -euo pipefail
systemctl restart ${CFG.service}
for i in $(seq 1 25); do
  if curl -fsS "http://127.0.0.1:${CFG.port}/api/health" >/dev/null 2>&1; then
    echo "健康检查通过（第 \${i} 次尝试）"
    echo "状态: $(systemctl is-active ${CFG.service}) / 开机自启: $(systemctl is-enabled ${CFG.service} 2>/dev/null)"
    curl -s "http://127.0.0.1:${CFG.port}/api/health"; echo
    echo "隔离确认: $(systemctl is-active ad_mining 2>/dev/null | sed 's/^/data_mining=/' || true) data_label=$(systemctl is-active ${CFG.service})"
    exit 0
  fi
  sleep 1
done
echo "!! 健康检查失败，最近日志："
journalctl -u ${CFG.service} -n 40 --no-pager || true
exit 1
`)
  console.log(tail(result.out, 12))
  if (result.code !== 0) { ssh.close(); die('服务未起来（详见上面日志）') }
}

ssh.close()
console.log(`\n✔ 部署完成（独立环境 data_label，与 data_mining 互不影响）`)
console.log(`   访问地址   http://${CFG.host}:${CFG.port}/`)
console.log(`   目录/服务  ${CFG.dir} / ${CFG.service}.service（账号 ${CFG.runUser}）`)
console.log(`   数据库     ${CFG.dbName}（专用账号 ${CFG.dbUser}）`)
console.log(`   查看日志   ssh ${TARGET} 'journalctl -u ${CFG.service} -f'`)
console.log(`   回滚       ssh ${TARGET} 'ls -t /root/${CFG.service}-backup-*.tar.gz | head -1'`)
console.log(`   说明文档   deploy/部署说明.md`)
