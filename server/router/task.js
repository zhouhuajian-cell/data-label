// 任务路由（需鉴权）：任务 CRUD、数据包、明细、成果提交/下载
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { ApiError, created, ok, readJson } from '../lib/http.js'
import { streamDownload } from '../lib/download.js'
import { submissions } from '../repositories/data.js'
import {
  acceptTask, createTask, dispatchTask, getTaskDetail, listTasks, reviewTask,
  submitTask, updateTask, deleteTask, completeWork, uploadTaskPackage
} from '../services/tasks.js'
import {
  getTaskItems, updateItemStatus, uploadScreenshot, updateItemStatusBatch,
  importTaskItems, uploadItemPackage, deleteTaskItem
} from '../services/items.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads')

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

  // ===== 成果文件下载 =====
  const subDownload = m(/^\/api\/submissions\/(\d+)\/download$/)
  if (subDownload && req.method === 'GET') {
    const sub = submissions.find(s => s.id === Number(subDownload[1]))
    if (!sub || !sub.storedName) throw new ApiError(404, 'NOT_FOUND', '文件不存在或未上传')
    streamDownload(res, uploadsDir, sub.storedName, sub.fileName || sub.storedName)
    return true
  }

  const fileDownload = m(/^\/api\/files\/download\/(.+)$/)
  if (fileDownload && req.method === 'GET') {
    const fileName = decodeURIComponent(fileDownload[1])
    streamDownload(res, uploadsDir, fileName, fileName)
    return true
  }

  // ===== 明细 =====
  const items = m(/^\/api\/tasks\/(\d+)\/items$/)
  if (items && req.method === 'GET') { ok(res, getTaskItems(Number(items[1]))); return true }

  const item = m(/^\/api\/tasks\/(\d+)\/items\/(\d+)$/)
  if (item && req.method === 'PUT') { ok(res, updateItemStatus(Number(item[1]), Number(item[2]), await body())); return true }
  if (item && req.method === 'DELETE') { ok(res, deleteTaskItem(Number(item[1]), Number(item[2]))); return true }

  const screenshot = m(/^\/api\/tasks\/(\d+)\/items\/screenshot$/)
  if (screenshot && req.method === 'POST') {
    const b = await body()
    ok(res, uploadScreenshot(Number(screenshot[1]), Number(b.itemId), b)); return true
  }

  const itemsBatch = m(/^\/api\/tasks\/(\d+)\/items\/batch$/)
  if (itemsBatch && req.method === 'PUT') { ok(res, updateItemStatusBatch(Number(itemsBatch[1]), await body())); return true }

  const itemsImport = m(/^\/api\/tasks\/(\d+)\/items\/import$/)
  if (itemsImport && req.method === 'POST') { created(res, importTaskItems(Number(itemsImport[1]), await body())); return true }

  const itemsImportFile = m(/^\/api\/tasks\/(\d+)\/items\/import-file$/)
  if (itemsImportFile && req.method === 'POST') {
    const { importTaskItemsFromFile } = await import('../services/items.js')
    created(res, await importTaskItemsFromFile(Number(itemsImportFile[1]), await body())); return true
  }

  const itemPkg = m(/^\/api\/tasks\/(\d+)\/items\/(\d+)\/package$/)
  if (itemPkg && req.method === 'POST') {
    const b = await body()
    ok(res, uploadItemPackage(Number(itemPkg[1]), Number(itemPkg[2]), b)); return true
  }
  return false
}
