// 一次性清库脚本：清业务数据（单据/明细/项目/通知/审计），保留账号与供应商名册
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../server/config.js'

const KEEP = ['users', 'suppliers', 'feishuConfig', 'scenarioDimensions']
const CLEAR = ['tasks', 'taskLogs', 'submissions', 'auditLogs', 'taskItems', 'projects',
  'workSessions', 'settlements', 'notifications', 'governedDatasets', 'governedItems']

const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.password, database: config.db.database
})

// 1) 备份
const backup = { createdAt: new Date().toISOString(), appState: {}, finance: {} }
const [stateRows] = await conn.query('SELECT name, data FROM app_state')
for (const r of stateRows) backup.appState[r.name] = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
const [billRows] = await conn.query('SELECT * FROM bills_finance')
const [itemRows] = await conn.query('SELECT * FROM bill_items_finance')
backup.finance.bills = billRows
backup.finance.items = itemRows
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupFile = path.join('server', 'data', `backup-${stamp}.json`)
fs.mkdirSync(path.dirname(backupFile), { recursive: true })
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8')
console.log(`备份完成 → ${backupFile}`)
console.log(`  单据 ${billRows.length} 张 / 明细 ${itemRows.length} 行 / 集合 ${stateRows.length} 个`)

// 2) 清关系表
await conn.query('DELETE FROM bill_items_finance')
await conn.query('DELETE FROM bills_finance')
console.log('已清空 bills_finance / bill_items_finance')

// 3) 清理 app_state 中的业务集合（保留 KEEP）
for (const key of CLEAR) {
  const [r] = await conn.query('SELECT data FROM app_state WHERE name = ?', [key])
  if (!r.length) continue
  const val = typeof r[0].data === 'string' ? JSON.parse(r[0].data) : r[0].data
  const n = Array.isArray(val) ? val.length : Object.keys(val || {}).length
  await conn.query('UPDATE app_state SET data = ? WHERE name = ?', [JSON.stringify([]), key])
  console.log(`  清空集合 ${key}（原 ${n} 项）`)
}
for (const key of KEEP) {
  const [r] = await conn.query('SELECT data FROM app_state WHERE name = ?', [key])
  if (!r.length) { console.log(`  [警告] 保留集合 ${key} 不存在`); continue }
  const val = typeof r[0].data === 'string' ? JSON.parse(r[0].data) : r[0].data
  console.log(`  保留集合 ${key}（${Array.isArray(val) ? val.length : Object.keys(val || {}).length} 项）`)
}

// 4) 删除留存附件文件
const dir = path.join('uploads', 'bills')
let deleted = 0, bytes = 0
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f)
    if (!fs.statSync(fp).isFile()) continue
    bytes += fs.statSync(fp).size
    fs.unlinkSync(fp)
    deleted++
  }
} else {
  console.log('  uploads/bills 不存在，跳过')
}
console.log(`已删除附件文件 ${deleted} 个（${(bytes / 1024).toFixed(1)} KB）`)

await conn.end()
console.log('清库完成。')
