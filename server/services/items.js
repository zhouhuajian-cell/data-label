import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../lib/http.js'
import { makeImage } from '../lib/images.js'
import { tasks, taskItems, taskLogs } from '../repositories/data.js'
import { nowText } from '../lib/time.js'
import { notifyByRole } from './notifications.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads/screenshots')

const ITEM_STATUS_MAP = {
  pending: '待标注', annotating: '标注中', annotated: '待供应商质检',
  submitted: '已提交', vendor_passed: '待甲方质检', accepted: '已验收',
  rework: '返工中', rejected: '返工中', failed: '失败'
}
const VALID_STATUSES = Object.keys(ITEM_STATUS_MAP)

function ensureDir() { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }) }

// 文件名白名单清洗：仅保留字母数字 . _ - 中文，防止路径穿越（与 tasks.js safeName 一致）
function safeFileName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_')
}

// 数据隔离：供应商角色(3,4)仅能访问本供应商任务下的明细（与 workbench.js ensureSupplierScope 一致）
function ensureTaskAccess(user, taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  const supplierRoles = [3, 4]
  if (supplierRoles.includes(user.roleType) && task.supplierId !== user.supplierId) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问其他供应商的数据')
  }
  return task
}

export function getTaskItems(user, taskId) {
  ensureTaskAccess(user, taskId)
  return taskItems.filter(item => item.taskId === taskId)
}

export function updateItemStatus(user, taskId, itemId, body) {
  ensureTaskAccess(user, taskId)
  const item = taskItems.find(i => i.id === itemId && i.taskId === taskId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  const status = String(body.status || '').trim()
  if (!VALID_STATUSES.includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', '无效状态')
  // 供应商不能手动置为已验收（accepted 仅由甲方验收流程产生）
  if ([3, 4].includes(user.roleType) && status === 'accepted') {
    throw new ApiError(403, 'FORBIDDEN', '已验收状态仅由甲方验收产生，不能手动修改')
  }
  if ([3, 4].includes(user.roleType) && ['rejected', 'rework'].includes(status)) {
    throw new ApiError(403, 'FORBIDDEN', '驳回/返工状态仅由甲方质检产生，供应商不能手动设置')
  }
  // 待甲方质检(vendor_passed) 是已提交后的自动状态，供应商不能手动设置
  if ([3, 4].includes(user.roleType) && status === 'vendor_passed') {
    throw new ApiError(403, 'FORBIDDEN', '待甲方质检状态由提交后自动流转产生，不能手动设置')
  }
  const prevStatus = item.status
  item.status = status
  item.failReason = String(body.failReason || '').trim()
  item.annotator = String(body.annotator || item.annotator || '').trim()
  if (status === 'submitted') {
    // 返修留痕：驳回(rework/rejected)后重新提交 → 记录第N次返修提交
    if (['rework', 'rejected'].includes(prevStatus)) {
      const n = (item.reworkCount || 0)
      if (!Array.isArray(item.history)) item.history = []
      item.history.push({ time: nowText(), actor: user.userName, action: 'resubmit', note: `第${n}次返修提交` })
      item.lastResubmitAt = nowText()
    }
    const task = tasks.find(t => t.id === taskId)
    notifyByRole(null, [1, 2], 'task', '待甲方质检提醒', `${user.userName} 将明细「${item.itemName}」改为已提交（任务：${task?.taskName || taskId}），待甲方质检`, 'task', taskId)
    checkAllSubmittedNotify(user, taskId)
  }
  return item
}

export function uploadScreenshot(user, taskId, itemId, body) {
  ensureTaskAccess(user, taskId)
  ensureDir()
  const item = taskItems.find(i => i.id === itemId && i.taskId === taskId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  if (!body.data) throw new ApiError(422, 'VALIDATION_ERROR', '请提供截图数据')
  const ext = (body.fileName || '').split('.').pop() || 'png'
  if (!/^[a-zA-Z0-9]{1,10}$/.test(ext)) throw new ApiError(422, 'VALIDATION_ERROR', '文件扩展名不合法')
  const fileName = `item_${itemId}_${Date.now()}.${safeFileName(ext)}`
  const filePath = path.join(uploadsDir, fileName)
  fs.writeFileSync(filePath, Buffer.from(body.data, 'base64'))
  item.screenshot = fileName
  return { fileName: body.fileName || fileName, storedName: fileName }
}

export function updateItemStatusBatch(user, taskId, body) {
  ensureTaskAccess(user, taskId)
  const { itemIds, status, failReason, annotator } = body
  if (!Array.isArray(itemIds) || !itemIds.length) throw new ApiError(422, 'VALIDATION_ERROR', '请选择明细')
  if (!VALID_STATUSES.includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', '无效状态')
  // 供应商批量限制：不能置已验收/驳回/返工（与单条一致）
  if ([3, 4].includes(user.roleType) && status === 'accepted') {
    throw new ApiError(403, 'FORBIDDEN', '已验收状态仅由甲方验收产生，不能手动修改')
  }
  if ([3, 4].includes(user.roleType) && ['rejected', 'rework'].includes(status)) {
    throw new ApiError(403, 'FORBIDDEN', '驳回/返工状态仅由甲方质检产生，供应商不能手动设置')
  }
  if ([3, 4].includes(user.roleType) && status === 'vendor_passed') {
    throw new ApiError(403, 'FORBIDDEN', '待甲方质检状态由提交后自动流转产生，不能手动设置')
  }
  let count = 0
  const batchStatus = status
  for (const id of itemIds) {
    const item = taskItems.find(i => i.id === id && i.taskId === taskId)
    if (!item) continue
    const prev = item.status
    item.status = status
    item.failReason = String(failReason || '').trim()
    item.annotator = String(annotator || '').trim()
    // 返修留痕：驳回后重新提交 → 记录第N次返修提交
    if (batchStatus === 'submitted' && ['rework', 'rejected'].includes(prev)) {
      if (!Array.isArray(item.history)) item.history = []
      item.history.push({ time: nowText(), actor: user.userName, action: 'resubmit', note: `第${item.reworkCount || 0}次返修提交` })
      item.lastResubmitAt = nowText()
    }
    count++
  }
  if (batchStatus === 'submitted' && count > 0) {
    const task = tasks.find(t => t.id === taskId)
    notifyByRole(null, [1, 2], 'task', '待甲方质检提醒', `${user.userName} 将任务「${task?.taskName || taskId}」的 ${count} 条明细改为已提交，待甲方质检`, 'task', taskId)
    checkAllSubmittedNotify(user, taskId)
  }
  return { updated: count }
}

// 任务下全部明细已提交 → 任务自动进入待甲方质检(CLIENT_QA)并推送飞书提醒
function checkAllSubmittedNotify(user, taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return
  const its = taskItems.filter(i => i.taskId === taskId)
  if (!its.length) return
  const allDone = its.every(i => ['submitted', 'accepted', 'vendor_passed'].includes(i.status))
  if (allDone && !['CLIENT_QA', 'ACCEPTED', 'ARCHIVED'].includes(task.state)) {
    task.state = 'CLIENT_QA'
    task.submitTime = nowText()
    taskLogs.push({ taskId: task.id, time: nowText(), content: user.userName + ' 全部明细已提交，任务进入待甲方质检', type: 'warning' })
    notifyByRole(null, [1, 2], 'task', '待甲方质检提醒', `${user.userName} 已将任务「${task.taskName}」全部明细改为已提交，任务状态为待甲方质检，请安排验收`, 'task', taskId)
  }
}

export function importTaskItems(user, taskId, body) {
  ensureTaskAccess(user, taskId)
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
      annotator: String(row.annotator || row['标注人'] || '').trim(),
      image: makeImage(maxId + imported + 1, itemName),
      annotation: { boxes: [] },
      claimedBy: null, workSeconds: 0, isRework: false,
      errorTypes: [], rejectNote: '', submitCount: 0, reworkCount: 0,
      clientReviewed: false, firstPass: null, history: [],
      tags: []
    })
    imported++
  }
  return { imported }
}

export function uploadItemPackage(user, taskId, itemId, body) {
  ensureTaskAccess(user, taskId)
  ensureDir()
  const item = taskItems.find(i => i.id === itemId && i.taskId === taskId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  if (!body.data) throw new ApiError(422, 'VALIDATION_ERROR', '请提供数据')
  const ext = (body.fileName || '').split('.').pop() || 'zip'
  if (!/^[a-zA-Z0-9]{1,10}$/.test(ext)) throw new ApiError(422, 'VALIDATION_ERROR', '文件扩展名不合法')
  const fileName = `pkg_${itemId}_${Date.now()}.${safeFileName(ext)}`
  const filePath = path.join(uploadsDir, fileName)
  fs.writeFileSync(filePath, Buffer.from(body.data, 'base64'))
  item.dataPackage = fileName
  return { fileName: body.fileName || fileName }
}

export function deleteTaskItem(user, taskId, itemId) {
  ensureTaskAccess(user, taskId)
  const idx = taskItems.findIndex(i => i.id === itemId && i.taskId === taskId)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '明细不存在')
  taskItems.splice(idx, 1)
  return { deleted: true }
}

// Excel/CSV 导入 → 解析后直接创建任务明细
// 编码感知解码：UTF-8 出现替换字符（\uFFFD）说明是 GBK 编码，改用 GBK 重解
function decodeCsvText(buffer) {
  let text = buffer.toString('utf-8')
  if (text.includes('\uFFFD')) {
    try { text = new TextDecoder('gbk').decode(buffer) } catch { /* 保持 utf-8 结果 */ }
  }
  return text.replace(/^\uFEFF/, '')
}

// 引号感知的 CSV 行解析（支持字段内含逗号/引号，如 "图像,模糊"）
function parseCsvLine(line) {
  const cells = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += ch
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',' || ch === '\t') {
      cells.push(cur.trim()); cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

// 判断某行是否为表头（命中至少 2 个已知列名，避免把标题行当表头）
function isItemHeaderRow(row) {
  let hits = 0
  const cells = row.map(h => String(h || ''))
  const patterns = [/名称|文件名|明细|源数据|name|log/i, /标注状态|状态|status/i, /类型|dataType|data type/i, /上传路径|上传|路径|upload|path/i, /标注人|清洗人|annotator|cleaner/i, /备注|失败原因|原因|意见|remark|reason|comment/i, /批次|batch/i, /标签|场景|tag/i]
  for (const s of cells) {
    for (const re of patterns) {
      if (re.test(s)) { hits++; break }
    }
  }
  return hits >= 2
}

// 导入明细的状态值归一化（Excel/CSV 中文或英文 -> 内部状态码）
const ITEM_STATUS_ALIASES = {
  pending: 'pending', 待标注: 'pending', 未标注: 'pending', 待分配: 'pending', 未开始: 'pending',
  annotated: 'annotated', 已标注: 'annotated', 标注完成: 'annotated', 已完成: 'annotated',
  vendor_passed: 'vendor_passed', 供应商质检通过: 'vendor_passed', 内审通过: 'vendor_passed', 质检通过: 'vendor_passed',
  accepted: 'accepted', 已验收: 'accepted', 验收通过: 'accepted',
  rejected: 'rejected', 驳回: 'rejected', 驳回整改: 'rejected', 整改: 'rejected',
  failed: 'failed', 失败: 'failed', 不合格: 'failed', 异常: 'failed',
  rework: 'rework', 返工: 'rework', 返工中: 'rework'
}
function normalizeItemStatus(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return 'pending'
  return ITEM_STATUS_ALIASES[v] || ITEM_STATUS_ALIASES[String(raw || '').trim()] || 'pending'
}

export async function importTaskItemsFromFile(user, taskId, body) {
  ensureTaskAccess(user, taskId)
  const fileData = body.fileData
  const fileName = String(body.fileName || 'data.csv').toLowerCase()
  if (!fileData) throw new ApiError(422, 'VALIDATION_ERROR', '请上传文件')

  const buffer = Buffer.from(fileData, 'base64')
  let rows = []
  try {
    if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      const text = decodeCsvText(buffer)
      rows = text.split(/\r?\n/).filter(l => l.trim()).map(parseCsvLine)
    } else {
      const XLSX = await import('../../node_modules/xlsx/xlsx.mjs')
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    }
  } catch (e) { throw new ApiError(422, 'VALIDATION_ERROR', '文件解析失败') }

  // 表头行自动定位：跳过标题行/空行（表头需命中至少 2 个已知列名）
  const headerIdx = rows.findIndex((r, i) => i < 8 && isItemHeaderRow(r || []))
  if (headerIdx < 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '未识别到表格表头，请使用「下载模板」的列（明细名称/数据类型/标注人/标注状态/备注/数据上传路径）')
  }
  const header = (rows[headerIdx] || []).map(h => String(h || '').trim())
  const colName = header.findIndex(h => /名称|文件名|明细|源数据|name|log/i.test(h))
  let colUploadPath = header.findIndex(h => /上传|upload/i.test(h))
  if (colUploadPath < 0) colUploadPath = header.findIndex(h => /路径|path/i.test(h) && !/下载|download/i.test(h))
  const colAnnotator = header.findIndex(h => /标注人|清洗人|人员|人员|annotator|cleaner/i.test(h))
  const colType = header.findIndex(h => /类型|dataType|data type/i.test(h))
  const colBatch = header.findIndex(h => /批次|batch/i.test(h))
  const colModel = header.findIndex(h => /车型|model/i.test(h))
  const colCheck = header.findIndex(h => /检测|检查|check/i.test(h))
  const colCleanTime = header.findIndex(h => /清洗时间|时间|clean.?time|time/i.test(h))
  const colTags = header.findIndex(h => /标签|场景|tag/i.test(h))
  const colStatus = header.findIndex(h => /标注状态|状态|status/i.test(h))
  const colFailReason = header.findIndex(h => /备注|失败原因|原因|意见|fail.?reason|remark|reason|comment/i.test(h))
  const colDownloadPath = header.findIndex(h => /下载路径|下载|download|download.?path/i.test(h))
  const colScene = header.findIndex(h => /场景|scene/i.test(h))
  const colCity = header.findIndex(h => /城市|city/i.test(h))
  const colMileage = header.findIndex(h => /里程|mileage|km/i.test(h))

  const maxId = Math.max(...taskItems.map(i => i.id), 0)
  let imported = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const itemName = colName >= 0 && r[colName] ? String(r[colName]).trim() : ('Item_' + String(i).padStart(3, '0'))
    imported++
    taskItems.push({
      id: maxId + imported, taskId, itemName,
      dataType: colType >= 0 ? String(r[colType] || '图像').trim() : '图像',
      status: colStatus >= 0 ? normalizeItemStatus(r[colStatus]) : 'pending',
      failReason: colFailReason >= 0 ? String(r[colFailReason] || '').trim() : '', screenshot: null,
      uploadPath: colUploadPath >= 0 ? String(r[colUploadPath] || '').trim() : '',
      annotator: colAnnotator >= 0 ? String(r[colAnnotator] || '').trim() : '',
      image: makeImage(maxId + imported, itemName), annotation: { boxes: [] },
      claimedBy: null, workSeconds: 0, isRework: false,
      errorTypes: [], rejectNote: '', submitCount: 0, reworkCount: 0,
      clientReviewed: false, firstPass: null, history: [],
      tags: colTags >= 0 && r[colTags] ? String(r[colTags]).split(/[,，、]/).map(t => t.trim()).filter(Boolean) : [],
      metadata: {
        batch: colBatch >= 0 ? String(r[colBatch] || '').trim() : '',
        model: colModel >= 0 ? String(r[colModel] || '').trim() : '',
        check: colCheck >= 0 ? String(r[colCheck] || '').trim() : '',
        cleanTime: colCleanTime >= 0 ? String(r[colCleanTime] || '').trim() : '',
        downloadPath: colDownloadPath >= 0 ? String(r[colDownloadPath] || '').trim() : '',
        scene: colScene >= 0 ? String(r[colScene] || '').trim() : '',
        city: colCity >= 0 ? String(r[colCity] || '').trim() : '',
        mileage: colMileage >= 0 ? String(r[colMileage] || '').trim() : ''
      }
    })
  }
  return { imported }
}
