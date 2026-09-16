// 从本地 MySQL 导出「账号 + 供应商名册 + 系统配置」种子，供服务器首次部署导入
// 用法：node scripts/export-seed.mjs [--out deploy/seed.json]
//
// 为什么需要：server/repositories/data.js 里内置了一套演示账号（taixing/123、supp_a 等）和 2 个演示供应商。
// 干净库启动时 app_state 里没有对应集合，内存就会保留这套演示数据 —— 直接上线会把演示账号带到生产。
// 本脚本把当前（已清理过业务数据的）真实集合导出，部署时由 scripts/seed-db.mjs 写入 app_state。
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { config } from '../server/config.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

// 与 server/repositories/store.js 的 KEYS 保持一致：业务集合一律导成空数组，
// 这样服务器启动时内存里的演示数据会被显式清空。
const SEED_KEYS = [
  'users', 'suppliers', 'feishuConfig', 'scenarioDimensions',
  'tasks', 'taskLogs', 'submissions', 'auditLogs', 'taskItems',
  'projects', 'workSessions', 'settlements', 'notifications',
  'governedDatasets', 'governedItems'
]

if (!config.db.enabled) {
  console.error('未配置 MySQL（DB_HOST 等为空），无法导出。')
  process.exit(1)
}

const outFile = path.resolve(arg('out', 'deploy/seed.json'))
const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.password, database: config.db.database
})

// 只有这四个集合带真实数据；其余（项目/单据/通知/审计等）一律写成空数组，
// 避免把本地正式库的业务数据带进部署包
const CARRY_KEYS = ['users', 'suppliers', 'feishuConfig', 'scenarioDimensions']
const collections = {}
for (const key of SEED_KEYS) collections[key] = []
const [rows] = await conn.query('SELECT name, data FROM app_state')
for (const row of rows) {
  if (!CARRY_KEYS.includes(row.name)) continue
  const val = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
  collections[row.name] = val
}

// 备份/关系表数据不导出：服务器从空库开始，只带账号与名册
const [[bills]] = await conn.query('SELECT COUNT(*) c FROM bills_finance')
const [[items]] = await conn.query('SELECT COUNT(*) c FROM bill_items_finance')
await conn.end()

// 归属供应商逻辑已删除：种子里的账号记录不再带历史 supplierId 字段
if (Array.isArray(collections.users)) {
  collections.users = collections.users.map(u => {
    const { supplierId, ...rest } = u
    return rest
  })
}

const seed = {
  exportedAt: new Date().toISOString(),
  source: `${config.db.host}:${config.db.port}/${config.db.database}`,
  note: '账号与供应商名册种子；业务数据为空。含密码哈希，勿提交到仓库。',
  collections
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(seed, null, 2), 'utf8')

const size = (v) => (Array.isArray(v) ? `${v.length} 项` : `${Object.keys(v || {}).length} 键`)
console.log(`已导出种子 → ${outFile}（源 ${seed.source}）`)
for (const key of SEED_KEYS) console.log(`  ${key}: ${size(collections[key])}`)
console.log(`（导出时本地库结算单 ${bills.c} 张 / 明细 ${items.c} 行 —— 这些不进入种子）`)
