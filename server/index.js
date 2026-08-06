import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, resolve } from 'node:path'
import { URL } from 'node:url'
import { config } from './config.js'
import { issueToken, requireAuth } from './lib/auth.js'
import { ApiError, created, fail, ok, readJson, sendJson } from './lib/http.js'
import { users, submissions } from './repositories/data.js'
import { loginByFeishuCode } from './services/auth.js'
import { createFeishuQrSession, pollFeishuSession, scanFeishuQr, getWebhookConfig, setWebhookConfig, sendFeishu, pushProjectSummary } from './services/feishu.js'
import { acceptTask, createTask, dispatchTask, getTaskDetail, listSuppliers, listTasks, reviewTask, submitTask, updateTask, deleteTask, importProjectTasks, completeWork, uploadTaskPackage } from './services/tasks.js'
import { getProjectStats, updateProjectCount, listProjects, createProject, updateProjectStatus, updateProject, importProjects, getProjectDetail, deleteProject, splitProjectDataset, archiveProject } from './services/projects.js'
import { getDashboardData } from './services/dashboard.js'
import { authLimiter, apiLimiter } from './lib/rate-limiter.js'
import { getTaskItems, updateItemStatus, uploadScreenshot, updateItemStatusBatch, importTaskItems, uploadItemPackage, deleteTaskItem } from './services/items.js'
import { loadStore, saveStore } from './repositories/store.js'
import { seedDemoData } from './services/seed.js'
import { getWorkbenchQueue, claimItem, claimQaTask, releaseQaTask, saveAnnotation, submitItem, vendorQaItem, clientQaItem, batchQaItems } from './services/workbench.js'
import { heartbeat, myTiming } from './services/timing.js'
import { generateSettlement, listSettlements, confirmSettlement, exportSettlementCsv } from './services/settlement.js'
import { getNotifications, markRead, markAllRead } from './services/notifications.js'
import { listDatasets, getDatasetItems, exportDataset } from './services/datasets.js'
import { getScenarioDimensions, saveScenarioDimension, deleteScenarioDimension, getTaggingQueue, saveItemTags, batchSaveTags } from './services/tagging.js'
import { importDataset, listGovernedDatasets, getDatasetDetail, updateDatasetStatus, tagGovernedItem, batchTagGovernedItems, seedGovernanceDemo, previewSplit, deleteDataset, deleteGovernedItem, importDatasetFromFile } from './services/governance.js'

function setCors(req, res) {
  const origin = req.headers.origin
  const allowed = config.corsOrigin === '*' || (origin && origin === config.corsOrigin)
  res.setHeader('access-control-allow-origin', allowed ? origin || String(config.corsOrigin) : String(config.corsOrigin))
  res.setHeader('vary', 'Origin')
  res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, Accept')
  res.setHeader('access-control-expose-headers', 'Authorization')
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('access-control-allow-credentials', 'true')
  res.setHeader('access-control-max-age', '86400')
}

function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('x-xss-protection', '1; mode=block')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('x-permitted-cross-domain-policies', 'none')
  res.setHeader('x-download-options', 'noopen')
}

function getClientKey(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
}

function route(method, pathname) {
  const taskDetail = pathname.match(/^\/api\/tasks\/(\d+)$/)
  const taskDispatch = pathname.match(/^\/api\/tasks\/(\d+)\/dispatch$/)
  const taskAccept = pathname.match(/^\/api\/tasks\/(\d+)\/accept$/)
  const taskComplete = pathname.match(/^\/api\/tasks\/(\d+)\/complete$/)
  const taskSubmit = pathname.match(/^\/api\/tasks\/(\d+)\/submissions$/)
  const taskReview = pathname.match(/^\/api\/tasks\/(\d+)\/review$/)
  const projectStats = pathname === '/api/projects/count' || pathname === '/api/project/count'
  return { taskDetail, taskDispatch, taskAccept, taskComplete, taskSubmit, taskReview, projectStats, is: (value) => method === value[0] && pathname === value[1] }
}

function normalizePath(pathname) {
  let normalized = String(pathname || '').replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) normalized = '/' + normalized
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  if (normalized === '') normalized = '/'
  if (normalized.startsWith('/api')) return normalized
  return '/api' + normalized
}

async function handle(req, res) {
  setCors(req, res)
  setSecurityHeaders(res)

  const requestId = crypto.randomUUID()
  res.setHeader('x-request-id', requestId)
  req.requestId = requestId

  if (req.method === 'OPTIONS') return sendJson(res, 204, null)

  const url = new URL(req.url, 'http://' + req.headers.host)
  const normalizedPath = normalizePath(url.pathname)
  const clientKey = 'api:' + getClientKey(req)

  if (process.env.NODE_ENV === 'production') {
    const isAuthRoute = normalizedPath.startsWith('/api/auth')
    if (isAuthRoute) {
      const limitResult = authLimiter(clientKey)
      if (!limitResult.allowed) {
        res.setHeader('retry-after', String(limitResult.retryAfter))
        throw new ApiError(429, 'RATE_LIMITED', `请求过于频繁，请 ${limitResult.retryAfter} 秒后重试`)
      }
    } else if (normalizedPath.startsWith('/api') && normalizedPath !== '/api/health') {
      const limitResult = apiLimiter(clientKey)
      if (!limitResult.allowed) {
        res.setHeader('retry-after', String(limitResult.retryAfter))
        throw new ApiError(429, 'RATE_LIMITED', `请求过于频繁，请 ${limitResult.retryAfter} 秒后重试`)
      }
    }
  }

  const r = route(req.method, normalizedPath)

  if (r.is(['GET', '/api/health'])) {
    return ok(res, { status: 'up', service: 'zhiyun-label-api', time: new Date().toISOString() })
  }

  if (r.is(['POST', '/api/auth/login'])) {
    const body = await readJson(req, config.maxBodyBytes)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const user = users.find(item => item.username === username && item.password === password && !item.disabled)
    if (!user) throw new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
    const { token, expiresIn } = issueToken(user)
    return ok(res, {
      token,
      expiresIn,
      userInfo: {
        userName: user.userName,
        roleType: user.roleType,
        supplierId: user.supplierId
      }
    })
  }

  if (r.is(['POST', '/api/auth/feishu'])) {
    const body = await readJson(req, config.maxBodyBytes)
    const user = loginByFeishuCode(body)
    const { token, expiresIn } = issueToken(user)
    return ok(res, {
      token,
      expiresIn,
      userInfo: {
        userName: user.userName,
        roleType: user.roleType,
        supplierId: user.supplierId
      }
    })
  }

  if (r.is(['POST', '/api/auth/feishu/qr'])) {
    return ok(res, createFeishuQrSession())
  }

  if (r.is(['GET', '/api/auth/feishu/qr'])) {
    const key = url.searchParams.get('key')
    return ok(res, pollFeishuSession(key))
  }

  if (r.is(['POST', '/api/auth/feishu/scan'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, scanFeishuQr(body))
  }

  const user = requireAuth(req)

  if (r.is(['GET', '/api/projects/count']) || (req.method === 'GET' && r.projectStats)) {
    return ok(res, getProjectStats(user))
  }

  if (r.is(['GET', '/api/dashboard'])) {
    return ok(res, getDashboardData(user))
  }

  if (r.is(['POST', '/api/projects/count']) || (req.method === 'POST' && r.projectStats)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateProjectCount(user, body))
  }

  if (r.is(['GET', '/api/projects'])) {
    return ok(res, listProjects(user))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/projects\/(\d+)$/)) {
    return ok(res, getProjectDetail(user, Number(RegExp.$1)))
  }

  if (r.is(['POST', '/api/projects'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, createProject(user, body))
  }

  if (r.is(['POST', '/api/projects/import'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, importProjects(user, body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/projects\/(\d+)\/tasks\/import$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, importProjectTasks(user, Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/projects\/(\d+)\/tasks\/import-file$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    const { parseTaskExcel } = await import('./services/excel.js')
    const result = await parseTaskExcel(user, body)
    if (!result.tasks || !result.tasks.length) throw new ApiError(422, 'VALIDATION_ERROR', '未解析到任务')
    let imported = 0
    for (const t of result.tasks) {
      await import('./services/tasks.js').then(m => m.createTask(user, { ...t, projectId: Number(RegExp.$1) }))
      imported++
    }
    return created(res, { imported })
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/projects\/(\d+)\/status$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateProjectStatus(user, Number(RegExp.$1), body))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/projects\/(\d+)$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateProject(user, Number(RegExp.$1), body))
  }

  if (req.method === 'DELETE' && normalizedPath.match(/^\/api\/projects\/(\d+)$/)) {
    return ok(res, deleteProject(user, Number(RegExp.$1)))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/projects\/(\d+)\/split$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, splitProjectDataset(user, Number(RegExp.$1), body))
  }

  if (r.is(['POST', '/api/projects/archive'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, archiveProject(user, Number(body.projectId)))
  }

  if (r.is(['GET', '/api/users/me'])) {
    return ok(res, { userName: user.userName, roleType: user.roleType, supplierId: user.supplierId })
  }

  if (r.is(['GET', '/api/suppliers'])) return ok(res, listSuppliers(user))

  if (r.is(['GET', '/api/tasks'])) {
    const result = listTasks(user, url.searchParams)
    return ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize })
  }

  if (r.is(['POST', '/api/tasks'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, createTask(user, body))
  }

  if (req.method === 'GET' && r.taskDetail) return ok(res, getTaskDetail(user, Number(r.taskDetail[1])))
  if (req.method === 'POST' && r.taskDispatch) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, dispatchTask(user, Number(r.taskDispatch[1]), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/package$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, uploadTaskPackage(user, Number(RegExp.$1), body))
  }
  if (req.method === 'POST' && r.taskAccept) return ok(res, acceptTask(user, Number(r.taskAccept[1])))
  if (req.method === 'POST' && r.taskComplete) return ok(res, completeWork(user, Number(r.taskComplete[1])))
  if (req.method === 'POST' && r.taskSubmit) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, submitTask(user, Number(r.taskSubmit[1]), body))
  }
  if (req.method === 'POST' && r.taskReview) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, reviewTask(user, Number(r.taskReview[1]), body))
  }

  if (req.method === 'PUT' && r.taskDetail) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateTask(user, Number(r.taskDetail[1]), body))
  }

  if (req.method === 'DELETE' && r.taskDetail) {
    return ok(res, deleteTask(user, Number(r.taskDetail[1])))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/submissions\/(\d+)\/download$/)) {
    const sub = submissions.find(s => s.id === Number(RegExp.$1))
    if (!sub || !sub.storedName) throw new ApiError(404, 'NOT_FOUND', '文件不存在或未上传')
    const uploadsDir = path.resolve(__dirname, '../uploads')
    const filePath = path.join(uploadsDir, sub.storedName)
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) throw new ApiError(404, 'NOT_FOUND', '文件不存在')
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap = { '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed' }
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(sub.fileName || sub.storedName)}` })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  if (req.method === 'GET' && normalizedPath.startsWith('/api/files/download/')) {
    const fileName = decodeURIComponent(normalizedPath.replace('/api/files/download/', ''))
    const uploadsDir = path.resolve(__dirname, '../uploads')
    const filePath = path.join(uploadsDir, ...fileName.split('/'))
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) throw new ApiError(404, 'NOT_FOUND', '文件不存在')
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap = { '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed', '.json': 'application/json', '.csv': 'text/csv', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg' }
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"` })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // 明细相关 API
  if (req.method === 'GET' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items$/)) {
    return ok(res, getTaskItems(Number(RegExp.$1)))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/(\d+)$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateItemStatus(Number(RegExp.$1), Number(RegExp.$2), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/screenshot$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, uploadScreenshot(Number(RegExp.$1), Number(body.itemId), body))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/batch$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateItemStatusBatch(Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/import$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, importTaskItems(Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/import-file$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    const { importTaskItemsFromFile } = await import('./services/items.js')
    return created(res, await importTaskItemsFromFile(Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/(\d+)\/package$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, uploadItemPackage(Number(RegExp.$1), Number(RegExp.$2), body))
  }

  if (req.method === 'DELETE' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/items\/(\d+)$/)) {
    return ok(res, deleteTaskItem(Number(RegExp.$1), Number(RegExp.$2)))
  }

  // ===== 标注工作台（PRD 4.1 / 3.2 极速返工流）=====
  if (req.method === 'GET' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/workbench$/)) {
    return ok(res, getWorkbenchQueue(user, Number(RegExp.$1)))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/items\/(\d+)\/claim$/)) {
    return ok(res, claimItem(user, Number(RegExp.$1)))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/qa-claim$/)) {
    return ok(res, claimQaTask(user, Number(RegExp.$1)))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/qa-release$/)) {
    return ok(res, releaseQaTask(user, Number(RegExp.$1)))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/items\/(\d+)\/annotation$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, saveAnnotation(user, Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/items\/(\d+)\/submit$/)) {
    return ok(res, submitItem(user, Number(RegExp.$1)))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/items\/(\d+)\/vendor-qa$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, vendorQaItem(user, Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/items\/(\d+)\/client-qa$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, clientQaItem(user, Number(RegExp.$1), body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/items\/batch-vendor-qa$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, batchQaItems(user, body, 'vendor'))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/items\/batch-client-qa$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, batchQaItems(user, body, 'client'))
  }

  // ===== 防挂机工时引擎（PRD 4.4）=====
  if (r.is(['POST', '/api/timing/heartbeat'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, heartbeat(user, body))
  }

  if (r.is(['GET', '/api/timing/my'])) {
    return ok(res, myTiming(user))
  }

  // ===== 阶梯绩效结算引擎（PRD 4.4）=====
  if (r.is(['GET', '/api/settlements'])) {
    return ok(res, listSettlements(user))
  }

  if (r.is(['POST', '/api/settlements/generate'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, generateSettlement(user, body))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/settlements\/(\d+)\/confirm$/)) {
    return ok(res, confirmSettlement(user, Number(RegExp.$1)))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/settlements\/(\d+)\/export$/)) {
    const csv = exportSettlementCsv(user, Number(RegExp.$1))
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(csv.fileName)}"`
    })
    res.end(csv.content)
    return
  }

  // ===== 消息通知（PRD 协同要求）=====
  if (r.is(['GET', '/api/notifications'])) {
    const result = getNotifications(user, url.searchParams)
    return ok(res, result.items, { total: result.total, unread: result.unread })
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/notifications\/(\d+)\/read$/)) {
    return ok(res, markRead(user, Number(RegExp.$1)))
  }

  if (r.is(['PUT', '/api/notifications/read-all'])) {
    return ok(res, markAllRead(user))
  }

  // ===== 飞书 Webhook =====
  if (r.is(['GET', '/api/feishu/webhook'])) {
    return ok(res, getWebhookConfig(user))
  }

  if (r.is(['POST', '/api/feishu/webhook'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, setWebhookConfig(user, body))
  }

  if (r.is(['POST', '/api/feishu/push'])) {
    const body = await readJson(req, config.maxBodyBytes)
    const cfg = getWebhookConfig(user)
    const targetIndex = body.webhookIndex !== undefined ? Number(body.webhookIndex) : -1
    const targets = targetIndex >= 0 && targetIndex < cfg.webhooks.length ? [cfg.webhooks[targetIndex].url] : null
    try {
      const result = await sendFeishu(body.title || '手动推送', body.content || '来自数据平台的消息', targets)
      return ok(res, result)
    } catch (e) {
      return ok(res, { sent: false, reason: e.message })
    }
  }

  // 推送项目摘要
  if (req.method === 'POST' && normalizedPath.match(/^\/api\/feishu\/project-summary\/(\d+)$/)) {
    const result = await pushProjectSummary(user, Number(RegExp.$1))
    return ok(res, result)
  }

  // ===== Excel 解析 =====
  if (r.is(['POST', '/api/projects/parse-excel'])) {
    const body = await readJson(req, config.maxBodyBytes)
    const { parseTaskExcel } = await import('./services/excel.js')
    return ok(res, parseTaskExcel(user, body))
  }

  // ===== 用户管理（PM 创建个人账号）=====
  if (r.is(['GET', '/api/users'])) {
    const { listUsers } = await import('./services/users.js')
    return ok(res, listUsers(user))
  }

  if (r.is(['POST', '/api/users'])) {
    const body = await readJson(req, config.maxBodyBytes)
    const { createUser } = await import('./services/users.js')
    return created(res, createUser(user, body))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/users\/(\d+)$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    const { updateUser } = await import('./services/users.js')
    return ok(res, updateUser(user, Number(RegExp.$1), body))
  }

  if (req.method === 'DELETE' && normalizedPath.match(/^\/api\/users\/(\d+)$/)) {
    const { deleteUser } = await import('./services/users.js')
    return ok(res, deleteUser(user, Number(RegExp.$1)))
  }

  // ===== 系统日志 =====
  if (r.is(['GET', '/api/admin/logs'])) {
    const { auditLogs, users } = await import('./repositories/data.js')
    const page = Math.max(Number(url.searchParams.get('page') || 1), 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') || 30), 1), 200)
    const typeFilter = String(url.searchParams.get('type') || '').trim()
    let list = auditLogs.slice().sort((a, b) => new Date(b.at||0) - new Date(a.at||0))
    if (typeFilter) list = list.filter(l => l.action && l.action.includes(typeFilter))
    const total = list.length
    const start = (page - 1) * pageSize
    const items = list.slice(start, start + pageSize).map(l => {
      const u = users.find(x => x.id === l.actorId)
      return { ...l, actorName: u?.userName || '未知' }
    })
    return ok(res, items, { total })
  }

  // ===== 数据集管理（PRD 算法视角：数据资产）=====
  if (r.is(['GET', '/api/datasets'])) {
    return ok(res, listDatasets(user))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/datasets\/(\d+)\/items$/)) {
    return ok(res, getDatasetItems(user, Number(RegExp.$1)))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/datasets\/(\d+)\/export$/)) {
    const ds = exportDataset(user, Number(RegExp.$1))
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ds.fileName)}` })
    res.end(ds.content)
    return
  }

  // ===== 数据场景打标签（数据清洗人员 roleType 7）=====
  if (r.is(['GET', '/api/scenario-dimensions'])) {
    return ok(res, getScenarioDimensions(user))
  }

  if (req.method === 'POST' && normalizedPath.match(/^\/api\/scenario-dimensions\/(\d+)$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, saveScenarioDimension(user, { ...body, id: Number(RegExp.$1) }))
  }

  if (r.is(['POST', '/api/scenario-dimensions'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, saveScenarioDimension(user, body))
  }

  if (req.method === 'DELETE' && normalizedPath.match(/^\/api\/scenario-dimensions\/(\d+)$/)) {
    return ok(res, deleteScenarioDimension(user, Number(RegExp.$1)))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/tasks\/(\d+)\/tagging$/)) {
    return ok(res, getTaggingQueue(user, Number(RegExp.$1)))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/items\/(\d+)\/tags$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, saveItemTags(user, Number(RegExp.$1), body))
  }

  if (r.is(['POST', '/api/items/batch-tags'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, batchSaveTags(user, body))
  }

  // ===== 数据治理中心（R&D 导入原始数据）=====
  if (r.is(['POST', '/api/governance/preview-split'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, previewSplit(user, body))
  }

  if (r.is(['GET', '/api/governance/datasets'])) {
    return ok(res, listGovernedDatasets(user))
  }

  if (req.method === 'GET' && normalizedPath.match(/^\/api\/governance\/datasets\/(\d+)$/)) {
    return ok(res, getDatasetDetail(user, Number(RegExp.$1)))
  }

  if (r.is(['POST', '/api/governance/import'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return created(res, importDataset(user, body))
  }

  if (r.is(['POST', '/api/governance/import-file'])) {
    const body = await readJson(req, config.maxBodyBytes)
    const result = await importDatasetFromFile(user, body)
    return created(res, result)
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/governance\/datasets\/(\d+)\/status$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, updateDatasetStatus(user, Number(RegExp.$1), body))
  }

  if (req.method === 'PUT' && normalizedPath.match(/^\/api\/governance\/items\/(\d+)\/tag$/)) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, tagGovernedItem(user, Number(RegExp.$1), body))
  }

  if (r.is(['POST', '/api/governance/items/batch-tag'])) {
    const body = await readJson(req, config.maxBodyBytes)
    return ok(res, batchTagGovernedItems(user, body))
  }

  if (req.method === 'DELETE' && normalizedPath.match(/^\/api\/governance\/datasets\/(\d+)$/)) {
    return ok(res, deleteDataset(user, Number(RegExp.$1)))
  }

  if (req.method === 'DELETE' && normalizedPath.match(/^\/api\/governance\/items\/(\d+)$/)) {
    return ok(res, deleteGovernedItem(user, Number(RegExp.$1)))
  }

  console.warn('No route matched:', {
    method: req.method,
    originalPath: req.url,
    normalizedPath,
    authorization: req.headers.authorization || null
  })
  throw new ApiError(404, 'NOT_FOUND', '接口不存在')
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const publicDir = resolve(__dirname, '../dist')

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
