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

// 启动：加载本地持久化数据；首次启动注入演示种子数据
if (!loadStore()) {
  seedDemoData()
  saveStore()
}
// 数据治理种子（无论是否已持久化都要补注入，仅首次时创建）
seedGovernanceDemo()
saveStore()

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

server.listen(config.port, config.host, () => {
  console.log('zhiyun-label-api listening on http://' + config.host + ':' + config.port)
})
