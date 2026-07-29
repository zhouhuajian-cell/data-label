import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../lib/http.js'
import { tasks, taskItems } from '../repositories/data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads/screenshots')

const ITEM_STATUS_MAP = { pending: '待标注', annotated: '已标注', rejected: '驳回', failed: '失败' }
const VALID_STATUSES = Object.keys(ITEM_STATUS_MAP)

function ensureDir() { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }) }

export function getTaskItems(taskId) {
  return taskItems.filter(item => item.taskId === taskId)
}

export function updateItemStatus(taskId, itemId, body) {
  const item = taskItems.find(i => i.id === itemId && i.taskId === taskId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  const status = String(body.status || '').trim()
  if (!VALID_STATUSES.includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', '无效状态')
  item.status = status
  item.failReason = String(body.failReason || '').trim()
  item.annotator = String(body.annotator || item.annotator || '').trim()
  return item
}

export function uploadScreenshot(taskId, itemId, body) {
  ensureDir()
  const item = taskItems.find(i => i.id === itemId && i.taskId === taskId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  if (!body.data) throw new ApiError(422, 'VALIDATION_ERROR', '请提供截图数据')
  const ext = (body.fileName || '').split('.').pop() || 'png'
  const fileName = `item_${itemId}_${Date.now()}.${ext}`
  const filePath = path.join(uploadsDir, fileName)
  fs.writeFileSync(filePath, Buffer.from(body.data, 'base64'))
  item.screenshot = fileName
  return { fileName: body.fileName || fileName, storedName: fileName }
}

export function updateItemStatusBatch(taskId, body) {
  const { itemIds, status, failReason, annotator } = body
  if (!Array.isArray(itemIds) || !itemIds.length) throw new ApiError(422, 'VALIDATION_ERROR', '请选择明细')
  if (!VALID_STATUSES.includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', '无效状态')
  let count = 0
  for (const id of itemIds) {
    const item = taskItems.find(i => i.id === id && i.taskId === taskId)
    if (!item) continue
    item.status = status
    item.failReason = String(failReason || '').trim()
    item.annotator = String(annotator || '').trim()
    count++
  }
  return { updated: count }
}

export function importTaskItems(taskId, body) {
  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', '数据为空')
  const maxId = Math.max(...taskItems.map(i => i.id), 0)
  let imported = 0
  for (const row of rows) {
    const itemName = String(row.itemName || row['明细名称'] || '').trim()
    if (!itemName) continue
    taskItems.push({
      id: maxId + imported + 1,
      taskId,
      itemName,
      dataType: String(row.dataType || row['数据类型'] || '').trim(),
      status: VALID_STATUSES.includes(row.status) ? row.status : 'pending',
      failReason: String(row.failReason || row['备注'] || '').trim(),
      screenshot: null,
      annotator: String(row.annotator || row['标注人'] || '').trim()
    })
    imported++
  }
  return { imported }
}

export function uploadItemPackage(taskId, itemId, body) {
  ensureDir()
  const item = taskItems.find(i => i.id === itemId && i.taskId === taskId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  if (!body.data) throw new ApiError(422, 'VALIDATION_ERROR', '请提供数据')
  const ext = (body.fileName || '').split('.').pop() || 'zip'
  const fileName = `pkg_${itemId}_${Date.now()}.${ext}`
  const filePath = path.join(uploadsDir, fileName)
  fs.writeFileSync(filePath, Buffer.from(body.data, 'base64'))
  item.dataPackage = fileName
  return { fileName: body.fileName || fileName }
}

export function deleteTaskItem(taskId, itemId) {
  const idx = taskItems.findIndex(i => i.id === itemId && i.taskId === taskId)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  taskItems.splice(idx, 1)
  return { deleted: true }
}
