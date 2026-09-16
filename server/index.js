// 服务入口：中间件编排 + 静态资源 + 启动（业务路由见 ./router/）
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, resolve } from 'node:path'
import { config } from './config.js'
import { ApiError, fail, sendJson } from './lib/http.js'
import { requireAuth } from './lib/auth.js'
import { loadStore, saveStore } from './repositories/store.js'
import { seedDemoData } from './services/seed.js'
import { migratePlaintextPasswords } from './services/migrations.js'
import { initFinanceDb, loadBills, migrateFromJsonCollections } from './repositories/finance-db.js'
import { bills as billsCache } from './repositories/data.js'
import { seedGovernanceDemo } from './services/governance.js'
import { createApiDispatcher } from './router/index.js'
import { setCors, setSecurityHeaders, applyRateLimit } from './middlewares.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const publicDir = resolve(__dirname, '../dist')

function normalizePath(pathname) {
  let normalized = String(pathname || '').replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) normalized = '/' + normalized
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  if (normalized === '') normalized = '/'
  if (normalized.startsWith('/api')) return normalized
  return '/api' + normalized
}

function serveStatic(req, res) {
  if (req.method !== 'GET') return false
  const url = new URL(req.url, 'http://' + req.headers.host)
  if (url.pathname.startsWith('/api')) return false

  const entry = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(publicDir, decodeURIComponent(entry))
  const ext = extname(filePath).toLowerCase()

  if (!filePath.startsWith(publicDir)) return false
  if (!fs.existsSync(filePath)) {
    const indexPath = join(publicDir, 'index.html')
    if (!fs.existsSync(indexPath)) return false
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    fs.createReadStream(indexPath).pipe(res)
    return true
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.ico': 'image/x-icon',
    '.map': 'application/octet-stream'
  }

  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': process.env.NODE_ENV === 'production' ? 'public, max-age=31536000, immutable' : 'no-cache'
  })
  fs.createReadStream(filePath).pipe(res)
  return true
}

const dispatchApi = createApiDispatcher(requireAuth)

async function handle(req, res) {
  setCors(req, res)
  setSecurityHeaders(res)

  const requestId = crypto.randomUUID()
  res.setHeader('x-request-id', requestId)
  req.requestId = requestId

  if (req.method === 'OPTIONS') return sendJson(res, 204, null)

  const url = new URL(req.url, 'http://' + req.headers.host)
  const normalizedPath = normalizePath(url.pathname)
  applyRateLimit(req, res, normalizedPath)

  if (await dispatchApi(req, res, url, normalizedPath)) return
  console.warn('No route matched:', { method: req.method, originalPath: req.url, normalizedPath })
  throw new ApiError(404, 'NOT_FOUND', '接口不存在')
}

const server = http.createServer((req, res) => {
  if (serveStatic(req, res)) return
  handle(req, res).catch(error => {
    console.error(JSON.stringify({
      level: 'error',
      requestId: req.requestId || '',
      path: req.url,
      method: req.method,
      message: error.message,
      stack: error.stack
    }))
    fail(res, error)
  }).finally(() => saveStore())
})

// 读取 app_state 中历史遗留的 JSON 集合（仅用于一次性迁移到关系表）
async function readLegacyCollection(name) {
  try {
    const mysql = (await import('mysql2/promise')).default
    const { config } = await import('./config.js')
    if (!config.db.enabled) return []
    const conn = await mysql.createConnection({
      host: config.db.host, port: config.db.port, user: config.db.user,
      password: config.db.password, database: config.db.database
    })
    const [rows] = await conn.query('SELECT data FROM app_state WHERE name = ?', [name])
    await conn.end()
    if (!rows.length) return []
    const val = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
    return Array.isArray(val) ? val : []
  } catch { return [] }
}

// 迁移完成后删除 app_state 中的历史集合行（数据已在关系表，不再需要）
async function dropLegacyCollections(names) {
  try {
    const mysql = (await import('mysql2/promise')).default
    const { config } = await import('./config.js')
    if (!config.db.enabled) return
    const conn = await mysql.createConnection({
      host: config.db.host, port: config.db.port, user: config.db.user,
      password: config.db.password, database: config.db.database
    })
    await conn.query('DELETE FROM app_state WHERE name IN (?)', [names])
    await conn.end()
    console.log(`已清理 app_state 中的历史集合：${names.join(', ')}`)
  } catch (e) {
    console.warn('清理历史集合失败（不影响运行）：', e.message)
  }
}

// 启动：加载本地持久化数据（优先 MySQL，回退 db.json）；首次启动注入演示种子数据
async function bootstrap() {
  const loaded = await loadStore()
  if (!loaded) {
    seedDemoData()
    await saveStore()
  }
  // 启动期迁移（幂等）：明文密码 → scrypt 哈希
  migratePlaintextPasswords()

  // 财务域：关系表初始化 → 历史 JSON 集合迁入 → 结算单载入内存缓存（明细按需查询）
  const financeSql = await initFinanceDb().catch(e => {
    console.error('财务域建表失败：', e.message)
    return false
  })
  if (financeSql) {
    const legacyBills = await readLegacyCollection('bills')
    const legacyItems = await readLegacyCollection('billItems')
    if (legacyBills.length) {
      const r = await migrateFromJsonCollections(legacyBills, legacyItems)
      if (r.migrated) {
        console.log(`已将 ${r.migrated} 张结算单 / ${r.items} 条明细从 app_state 迁入关系表`)
        await dropLegacyCollections(['bills', 'billItems'])
      } else if (r.skipped) {
        console.log('关系表已有数据，跳过 JSON 集合迁移（如需重跑请先清空关系表）')
      }
    }
    const loaded = await loadBills()
    billsCache.splice(0, billsCache.length, ...loaded)
    console.log(`已载入 ${loaded.length} 张结算单（明细按需查询）`)
    // 确认链新增节点后，历史单据的 currentStage 会错位：按确认记录重新定位
    const { repairBillStages } = await import('./services/bills.js')
    const fixed = await repairBillStages()
    if (fixed) console.log(`已按确认记录重定位 ${fixed} 张结算单的当前环节`)
  }
  // 数据治理演示数据：默认不注入（需要时用 SEED_GOVERNANCE_DEMO=1 开启）
  // 原因：该模块当前在界面上已隐藏，自动回灌只会在库里留一批看不见的演示数据
  if (process.env.SEED_GOVERNANCE_DEMO === '1') {
    seedGovernanceDemo()
  }
  await saveStore()
  server.listen(config.port, config.host, () => {
    console.log('data-label-api listening on http://' + config.host + ':' + config.port)
  })
}
bootstrap().catch(error => {
  console.error('服务启动失败:', error.message)
  process.exit(1)
})

// 截止时间提醒（提前2天推送飞书）
import('./services/deadline-reminder.js').then(m => m.startDeadlineReminder()).catch(() => {})

process.on('uncaughtException', error => {
  console.error('UNCAUGHT_EXCEPTION', { message: error.message, stack: error.stack })
})

process.on('unhandledRejection', reason => {
  console.error('UNHANDLED_REJECTION', { message: reason?.message || reason, stack: reason?.stack })
})

function gracefulShutdown(signal) {
  console.log(`[${signal}] 正在优雅关闭服务...`)
  if (server) {
    server.close(() => {
      console.log('HTTP 服务已关闭')
      process.exit(0)
    })
    setTimeout(() => {
      console.error('强制退出：超时')
      process.exit(1)
    }, 10000).unref()
  } else {
    process.exit(0)
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))


