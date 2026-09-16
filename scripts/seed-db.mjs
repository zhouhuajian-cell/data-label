// 把种子（deploy/seed.json）导入 MySQL 的 app_state 集合表
// 用法：
//   node scripts/seed-db.mjs                  # 只填「当前为空」的集合，可重复执行
//   node scripts/seed-db.mjs --force          # 覆盖写入全部集合（会用种子覆盖现有账号！）
//   node scripts/seed-db.mjs --seed <路径>    # 指定种子文件
//
// 幂等：默认语义是"空则填"，重复部署不会覆盖服务器上已修改的账号/配置。
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { config } from '../server/config.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const seedFile = path.resolve(arg('seed', 'deploy/seed.json'))
if (!fs.existsSync(seedFile)) {
  console.error(`种子文件不存在：${seedFile}（先在本地执行 node scripts/export-seed.mjs）`)
  process.exit(1)
}
if (!config.db.enabled) {
  console.error('未配置 MySQL（DB_HOST 等为空）。请检查 .env。')
  process.exit(1)
}

const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
const force = flag('force')

const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.password, database: config.db.database,
  multipleStatements: true
})

// 与 store.js 相同的建表语句，保证首次部署时表结构存在
await conn.query(`CREATE TABLE IF NOT EXISTS app_state (
  name VARCHAR(64) PRIMARY KEY,
  data JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

const count = (v) => (Array.isArray(v) ? v.length : Object.keys(v || {}).length)
const rows = []
let written = 0
let skipped = 0

for (const [name, value] of Object.entries(seed.collections || {})) {
  const [existing] = await conn.query('SELECT data FROM app_state WHERE name = ?', [name])
  let reason = '新建'
  if (existing.length) {
    const cur = typeof existing[0].data === 'string' ? JSON.parse(existing[0].data) : existing[0].data
    const curCount = count(cur)
    if (!force && curCount > 0) {
      rows.push(`  跳过 ${name}：已有 ${curCount} 项（如需覆盖请加 --force）`)
      skipped++
      continue
    }
    reason = curCount > 0 ? `覆盖（原 ${curCount} 项）` : `填充空集合`
  }
  await conn.query(
    'INSERT INTO app_state (name, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [name, JSON.stringify(value)]
  )
  rows.push(`  ${reason} ${name}：${count(value)} 项`)
  written++
}

const [[u]] = await conn.query("SELECT data FROM app_state WHERE name = 'users'")
const users = typeof u.data === 'string' ? JSON.parse(u.data) : u.data
await conn.end()

console.log(`种子导入完成（${seedFile}，${force ? '覆盖模式' : '空则填模式'}）：写入 ${written} 个集合，跳过 ${skipped} 个`)
rows.forEach((r) => console.log(r))
console.log(`当前库内账号数：${users.length}，其中管理员/业务账号示例：${users.slice(-6).map((x) => x.username).join(', ')}`)
