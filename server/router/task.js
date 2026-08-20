// 任务路由（需鉴权）：任务 CRUD、数据包、明细、成果提交/下载
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { ApiError, created, ok, readJson } from '../lib/http.js'
import { streamDownload } from '../lib/download.js'
import { submissions, tasks, taskItems } from '../repositories/data.js'
import {
  acceptTask, createTask, dispatchTask, getTaskDetail, listTasks, reviewTask,
  submitTask, updateTask, updateTaskState, deleteTask, completeWork, uploadTaskPackage
} from '../services/tasks.js'
import {
  getTaskItems, updateItemStatus, uploadScreenshot, updateItemStatusBatch,
  importTaskItems, uploadItemPackage, deleteTaskItem
} from '../services/items.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads')

// 数据隔离：供应商角色(3,4)仅能下载/访问本供应商任务下的文件（与 services/items.js ensureTaskAccess 一致）
function ensureTaskVisible(user, taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  const supplierRoles = [3, 4]
  if (supplierRoles.includes(user.roleType) && task.supplierId !== user.supplierId) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问其他供应商的数据')
  }
  return task
}

export async function taskRouter(ctx) {
  const { req, res, url, pathname, user } = ctx
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  if (is('GET', '/api/tasks')) {
    const result = listTasks(user, url.searchParams)
    ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize })
    return true
  }
  if (is('POST', '/api/tasks')) { created(res, createTask(user, await body())); return true }

  const taskId = m(/^\/api\/tasks\/(\d+)$/)
  if (taskId && req.method === 'GET') { ok(res, getTaskDetail(user, Number(taskId[1]))); return true }
  if (taskId && req.method === 'PUT') { ok(res, updateTask(user, Number(taskId[1]), await body())); return true }
  if (taskId && req.method === 'DELETE') { ok(res, deleteTask(user, Number(taskId[1]))); return true }

  const dispatch = m(/^\/api\/tasks\/(\d+)\/dispatch$/)
  if (dispatch && req.method === 'POST') { ok(res, dispatchTask(user, Number(dispatch[1]), await body())); return true }

  const pkg = m(/^\/api\/tasks\/(\d+)\/package$/)
  if (pkg && req.method === 'POST') { ok(res, uploadTaskPackage(user, Number(pkg[1]), await body())); return true }

  const accept = m(/^\/api\/tasks\/(\d+)\/accept$/)
  if (accept && req.method === 'POST') { ok(res, acceptTask(user, Number(accept[1]))); return true }

  const complete = m(/^\/api\/tasks\/(\d+)\/complete$/)
  if (complete && req.method === 'POST') { ok(res, completeWork(user, Number(complete[1]))); return true }

  const submit = m(/^\/api\/tasks\/(\d+)\/submissions$/)
  if (submit && req.method === 'POST') { created(res, submitTask(user, Number(submit[1]), await body())); return true }

  const review = m(/^\/api\/tasks\/(\d+)\/review$/)
  if (review && req.method === 'POST') { ok(res, reviewTask(user, Number(review[1]), await body())); return true }

  const stateUpd = m(/^\/api\/tasks\/(\d+)\/status$/)
  if (stateUpd && req.method === 'PUT') { ok(res, updateTaskState(user, Number(stateUpd[1]), await body())); return true }

  // ===== 成果文件下载 =====
  const subDownload = m(/^\/api\/submissions\/(\d+)\/download$/)
  if (subDownload && req.method === 'GET') {
    const sub = submissions.find(s => s.id === Number(subDownload[1]))
    if (!sub || !sub.storedName) throw new ApiError(404, 'NOT_FOUND', '文件不存在或未上传')
    ensureTaskVisible(user, sub.taskId)
    streamDownload(res, uploadsDir, sub.storedName, sub.fileName || sub.storedName)
    return true
  }

  const fileDownload = m(/^\/api\/files\/download\/(.+)$/)
  if (fileDownload && req.method === 'GET') {
    const fileName = decodeURIComponent(fileDownload[1])
    // 按文件名反查文件归属的任务，做数据隔离校验（防止直接猜文件名下载任意文件）
    const ownerTask = tasks.find(t => t.dataPackage && t.dataPackage.storedName === fileName)
    const ownerItem = taskItems.find(i => i.dataPackage === fileName || i.screenshot === fileName || (Array.isArray(i.rejectImages) && i.rejectImages.some(r => r.storedName === fileName)))
    const ownerSub = submissions.find(s => s.storedName === fileName)
    if (!ownerTask && !ownerItem && !ownerSub) throw new ApiError(404, 'NOT_FOUND', '文件不存在')
    // 三种归属各自取所属任务 id（不能直接用命中对象的 id——submission/item 的 id 与任务 id 是两套自增序列）
    const taskId = ownerTask ? ownerTask.id : (ownerItem ? ownerItem.taskId : ownerSub.taskId)
    ensureTaskVisible(user, taskId)
    // 明细包/截图存在 uploads/screenshots/ 子目录，其余在 uploads/ 根目录：逐个尝试定位
    const candidates = [path.join(uploadsDir, fileName), path.join(uploadsDir, 'screenshots', fileName)]
    const target = candidates.find(c => c.startsWith(uploadsDir) && fs.existsSync(c))
    if (!target) throw new ApiError(404, 'NOT_FOUND', '文件不存在')
    const rel = path.relative(uploadsDir, target).split(path.sep).join('/')
    streamDownload(res, uploadsDir, rel, fileName)
    return true
  }

  // ===== 明细 =====
  const items = m(/^\/api\/tasks\/(\d+)\/items$/)
  if (items && req.method === 'GET') { ok(res, getTaskItems(user, Number(items[1]))); return true }

  const item = m(/^\/api\/tasks\/(\d+)\/items\/(\d+)$/)
  if (item && req.method === 'PUT') { ok(res, updateItemStatus(user, Number(item[1]), Number(item[2]), await body())); return true }
  if (item && req.method === 'DELETE') { ok(res, deleteTaskItem(user, Number(item[1]), Number(item[2]))); return true }

  const screenshot = m(/^\/api\/tasks\/(\d+)\/items\/screenshot$/)
  if (screenshot && req.method === 'POST') {
    const b = await body()
    ok(res, uploadScreenshot(user, Number(screenshot[1]), Number(b.itemId), b)); return true
  }

  const itemsBatch = m(/^\/api\/tasks\/(\d+)\/items\/batch$/)
  if (itemsBatch && req.method === 'PUT') { ok(res, updateItemStatusBatch(user, Number(itemsBatch[1]), await body())); return true }

  const itemsImport = m(/^\/api\/tasks\/(\d+)\/items\/import$/)
  if (itemsImport && req.method === 'POST') { created(res, importTaskItems(user, Number(itemsImport[1]), await body())); return true }

  const itemsImportFile = m(/^\/api\/tasks\/(\d+)\/items\/import-file$/)
  if (itemsImportFile && req.method === 'POST') {
    const { importTaskItemsFromFile } = await import('../services/items.js')
    created(res, await importTaskItemsFromFile(user, Number(itemsImportFile[1]), await body())); return true
  }

  const itemPkg = m(/^\/api\/tasks\/(\d+)\/items\/(\d+)\/package$/)
  if (itemPkg && req.method === 'POST') {
    const b = await body()
    ok(res, uploadItemPackage(user, Number(itemPkg[1]), Number(itemPkg[2]), b)); return true
  }
  return false
}
