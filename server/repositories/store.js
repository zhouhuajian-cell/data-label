import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import * as data from './data.js'
import { config } from '../config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbDir = path.resolve(__dirname, '../data')
const dbFile = path.join(dbDir, 'db.json')

// 需要持久化的集合（保持数组引用不变，仅替换元素，避免影响既有 import）
const KEYS = ['users', 'suppliers', 'tasks', 'taskLogs', 'submissions', 'auditLogs', 'taskItems', 'projects', 'workSessions', 'settlements', 'notifications', 'scenarioDimensions', 'governedDatasets', 'governedItems', 'feishuConfig', 'gndUsers', 'gndSuppliers', 'gndTasks', 'gndSubmissions', 'gndOptimizations', 'gndAcceptances', 'gndWarehouseRecords', 'gndPerceptions', 'gndStatusHistory', 'gndFieldHistory', 'gndOptions']
const MYSQL_TABLE = 'app_state'

let pool = null
let mysqlState = null // 'ok' | 'fail' | null(未探测)

function getPool() {
  if (!config.db.enabled) return null
  if (pool) return pool
  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true
  })
  return pool
}

async function initDb(p) {
  await p.query(`CREATE TABLE IF NOT EXISTS ${MYSQL_TABLE} (
    name VARCHAR(64) PRIMARY KEY,
    data JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

function applyToMemory(collections) {
  for (const key of KEYS) {
    const value = collections[key]
    if (value === undefined) continue
    if (Array.isArray(value) && Array.isArray(data[key])) {
      data[key].splice(0, data[key].length, ...value)
    } else if (typeof value === 'object' && typeof data[key] === 'object' && !Array.isArray(data[key])) {
      Object.assign(data[key], value)
    }
  }
}

// 从 MySQL 读取全部集合：{ ok, empty, collections }
async function readFromMysql() {
  const p = getPool()
  if (!p) return { ok: false, reason: 'disabled' }
  try {
    await initDb(p)
    const [rows] = await p.query(`SELECT name, data FROM ${MYSQL_TABLE}`)
    mysqlState = 'ok'
    if (!rows.length) return { ok: true, empty: true, collections: {} }
    const collections = {}
    for (const row of rows) {
      try {
        // mysql2 对 JSON 列会返回已解析对象，也可能返回字符串，两种情况都兼容
        const val = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        if (val !== null && typeof val === 'object') collections[row.name] = val
      } catch { /* 跳过损坏行 */ }
    }
    return { ok: true, empty: false, collections }
  } catch (e) {
    mysqlState = 'fail'
    console.error('MySQL 读取失败，回退本地 db.json:', e.message)
    return { ok: false, reason: 'error' }
  }
}

// 从本地 db.json 读取
function readFromFile() {
  if (!fs.existsSync(dbFile)) return false
  try {
    const json = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    applyToMemory(json)
    return true
  } catch (error) {
    console.error('加载本地数据文件失败:', error.message)
    return false
  }
}

// 加载数据：优先 MySQL；MySQL 为空时迁移 db.json；MySQL 不可用时回退 db.json
export async function loadStore() {
  const mysqlResult = await readFromMysql()
  if (mysqlResult.ok && !mysqlResult.empty) {
    applyToMemory(mysqlResult.collections)
    console.log(`已从 MySQL 加载数据（${KEYS.filter(k => mysqlResult.collections[k] !== undefined).length} 个集合）`)
    return true
  }
  const loaded = readFromFile()
  if (mysqlResult.ok && mysqlResult.empty && loaded) {
    // 首次使用 MySQL：把 db.json 数据迁移进去
    await saveStore()
    console.log('已将 db.json 数据迁移到 MySQL')
  }
  return loaded
}

let timer = null
// 保存数据：优先 MySQL；MySQL 不可用或未配置时回退写 db.json
export async function saveStore() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      const p = getPool()
      if (p) {
        const conn = await p.getConnection()
        try {
          await conn.beginTransaction()
          for (const key of KEYS) {
            await conn.query(
              `INSERT INTO ${MYSQL_TABLE} (name, data) VALUES (?, ?)
               ON DUPLICATE KEY UPDATE data = VALUES(data)`,
              [key, JSON.stringify(data[key])]
            )
          }
          await conn.commit()
          mysqlState = 'ok'
          return
        } catch (e) {
          await conn.rollback().catch(() => {})
          throw e
        } finally {
          conn.release()
        }
      }
      // 回退：写本地 db.json
      const out = {}
      for (const key of KEYS) out[key] = data[key]
      fs.mkdirSync(dbDir, { recursive: true })
      fs.writeFileSync(dbFile, JSON.stringify(out))
    } catch (error) {
      mysqlState = 'fail'
      // 写 MySQL 失败时回退写 db.json，避免数据丢失
      try {
        const out = {}
        for (const key of KEYS) out[key] = data[key]
        fs.mkdirSync(dbDir, { recursive: true })
        fs.writeFileSync(dbFile, JSON.stringify(out))
        console.error('MySQL 保存失败，已回退写入本地 db.json:', error.message)
      } catch (fileError) {
        console.error('保存本地数据文件失败:', fileError.message)
      }
    }
  }, 300)
}
