#!/usr/bin/env node
// 一键启动：环境自检 → 释放端口 → 装依赖 → 构建前端 → 启动服务 → 打开浏览器
// 用法：
//   node scripts/start.mjs              正常启动（会重新构建前端）
//   node scripts/start.mjs --no-build   跳过前端构建（只改后端时更快）
//   node scripts/start.mjs --dev        开发模式：起 vite(3000) + api(3001)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config } from '../server/config.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const NO_BUILD = args.includes('--no-build')
const DEV = args.includes('--dev')

const API_PORT = config.port
const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[90m', b: '\x1b[36m', x: '\x1b[0m' }
const log = (...a) => console.log(...a)
const ok = (m) => log(`${c.g}✓${c.x} ${m}`)
const warn = (m) => log(`${c.y}!${c.x} ${m}`)
const err = (m) => log(`${c.r}✗${c.x} ${m}`)
const step = (n, m) => log(`\n${c.b}【${n}】${m}${c.x}`)

function ensureEnvFile() {
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) {
    const sample = path.join(root, '.env.example')
    if (fs.existsSync(sample)) fs.copyFileSync(sample, file)
    else fs.writeFileSync(file, '')
    warn('未找到 .env，已从 .env.example 生成')
  }
  let content = fs.readFileSync(file, 'utf8')
  const patch = (key, value) => {
    if (new RegExp('^' + key + '=', 'm').test(content)) {
      content = content.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=' + value)
    } else {
      content = content.trimEnd() + '\n' + key + '=' + value + '\n'
    }
  }
  // 用项目自己的 config.js 判断（它读 .env 的可靠性由服务端日常使用验证）
  if (config.jwtSecret === 'dev-only-change-me') {
    patch('JWT_SECRET', crypto.randomBytes(48).toString('base64url'))
    ok('已生成随机 JWT_SECRET 写入 .env（下次启动生效）')
  }
  if (process.env.NODE_ENV !== 'production') {
    patch('NODE_ENV', 'production')
    ok('已写入 NODE_ENV=production（下次启动生效）')
  }
  fs.writeFileSync(file, content)
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 18) {
    err(`Node 版本过低（当前 ${process.versions.node}），需要 18+（推荐 20）`)
    process.exit(1)
  }
  ok(`Node ${process.versions.node}`)
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '0.0.0.0')
  })
}

// 释放端口：找出占用进程并结束（避免残留旧实例用旧配置/旧内存快照覆盖数据）
function freePort(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true }).stdout || ''
  const pids = new Set()
  for (const line of out.split('\n')) {
    if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
      const pid = line.trim().split(/\s+/).pop()
      if (/^\d+$/.test(pid) && Number(pid) !== process.pid) pids.add(pid)
    }
  }
  if (!pids.size) return false
  for (const pid of pids) {
    warn(`端口 ${port} 被进程 ${pid} 占用，正在结束它（旧实例必须清掉，否则会用旧配置抢应答）`)
    spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true })
  }
  spawnSync('timeout', ['/t', '2', '/nobreak'], { shell: true, windowsHide: true })
  return true
}

function run(cmd, cmdArgs, label) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    err(`${label} 失败`)
    process.exit(1)
  }
  ok(label)
}

async function waitHealth(port, seconds = 30) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return true
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 800))
  }
  return false
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' }).unref()
}

const main = async () => {
  log(`${c.b}
========================================================
        Maxieye 数据协作平台 · 一键启动
========================================================${c.x}`)

  step('1/5', '环境自检')
  checkNode()
  ensureEnvFile()
  if (config.db.enabled) {
    ok(`MySQL 已配置：${config.db.host}:${config.db.port}/${config.db.database}`)
  } else {
    warn('未配置 MySQL（DB_HOST/DB_USER/DB_NAME 不全）—— 会退回本地 db.json，数据量一大不安全')
  }
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    step('2/5', '安装依赖（首次较慢）')
    run('npm', ['install'], 'npm install 完成')
  } else {
    step('2/5', '依赖已存在，跳过安装')
  }

  step('3/5', `释放端口 ${API_PORT}`)
  if (await isPortFree(API_PORT)) ok(`端口 ${API_PORT} 空闲`)
  else if (!freePort(API_PORT)) warn(`端口 ${API_PORT} 检测异常，继续尝试启动`)

  if (DEV) {
    step('4/5', '开发模式：启动 vite(3000) + api(3001)')
    const api = spawn('node', ['server/index.js'], { cwd: root, stdio: 'inherit', shell: true })
    const vite = spawn('npm', ['run', 'dev'], { cwd: root, stdio: 'inherit', shell: true })
    const stop = () => { try { api.kill(); vite.kill() } catch {} process.exit(0) }
    process.on('SIGINT', stop); process.on('SIGTERM', stop)
    return
  }

  step('4/5', NO_BUILD ? '跳过前端构建（--no-build）' : '构建前端 → dist/')
  if (!NO_BUILD) run('npm', ['run', 'build'], '前端构建完成')
  else if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    warn('dist 不存在，改为强制构建')
    run('npm', ['run', 'build'], '前端构建完成')
  }

  step('5/5', `启动服务（端口 ${API_PORT}）`)
  const server = spawn('node', ['server/index.js'], { cwd: root, stdio: 'inherit', shell: true })
  server.on('exit', (code) => {
    log('')
    err(`服务已退出（exit ${code}）`)
    process.exit(code ?? 0)
  })
  process.on('SIGINT', () => { try { server.kill() } catch {}; process.exit(0) })

  const url = `http://127.0.0.1:${API_PORT}`
  const up = await waitHealth(API_PORT)
  if (up) {
    ok(`服务已就绪：${url}`)
    log(`${c.d}   管理员：taixing / 123      其他账号密码：123456
   停止服务：在本窗口按 Ctrl+C${c.x}`)
    openBrowser(url)
  } else {
    warn('服务启动超时，请查看上方日志')
  }
  log('')
  log(`${c.d}--------------------------------------------------------
  提示：后端改动需重启本脚本；前端改动会被自动重新构建
  仅改后端时可加 --no-build 跳过构建，启动更快
--------------------------------------------------------${c.x}`)
}

main().catch((e) => { err(e.message); process.exit(1) })
