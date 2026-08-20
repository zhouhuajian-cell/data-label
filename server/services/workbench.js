import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../lib/http.js'
import { tasks, taskItems, auditLogs, ERROR_TYPES, submissions, taskLogs } from '../repositories/data.js'
import { createNotification } from './notifications.js'
import { nowText } from '../lib/time.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rejectImgDir = path.resolve(__dirname, '../../uploads/screenshots')
function ensureRejectImgDir() { if (!fs.existsSync(rejectImgDir)) fs.mkdirSync(rejectImgDir, { recursive: true }) }
function saveRejectImages(item, images) {
  if (!Array.isArray(images) || !images.length) return
  const list = []
  for (const img of images) {
    if (!img || !img.data || !img.fileName) continue
    const ext = String(img.fileName).split('.').pop() || 'png'
    if (!/^[a-zA-Z0-9]{1,10}$/.test(ext)) continue
    const safeName = String(img.fileName).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_')
    const storedName = `reject_${item.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`
    ensureRejectImgDir()
    try { fs.writeFileSync(path.join(rejectImgDir, storedName), Buffer.from(img.data, 'base64')) } catch { continue }
    list.push({ fileName: safeName, storedName })
  }
  if (list.length) item.rejectImages = list
}

// 检查任务下明细状态，条件满足时自动推进任务状态
function autoAdvanceTask(taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return
  const items = taskItems.filter(i => i.taskId === taskId)
  if (!items.length) return

  // 注意：进入供应商质检由「完成作业」显式触发（供应商标注完 → completeWork → VENDOR_QA），
  // 不自动跳转，保证流程节点完整可控
  // 全部 accepted → 自动验收；或无残留 vendor_passed（QA 抽样通过）
  if (items.every(i => i.status === 'accepted')) {
    task.state = 'ACCEPTED'
    task.acceptTime = nowText()
    taskLogs.push({ taskId, time: nowText(), content: '所有明细已通过甲方质检，验收完成', type: 'success' })
    auditLogs.push({ action: 'task.autoAccepted', taskId, at: nowText() })
    markAcceptedSubmission(taskId)
    import('./settlement.js').then(m => m.autoGenerateSettlement(taskId, '系统')).catch(() => {})
    import('./tasks.js').then(m => m.pushAcceptanceReport(taskId, '系统')).catch(() => {})
  }
  // 注意：仅当任务下全部明细都验收通过(accepted)时才将任务置为「已验收」；
  // 部分验收时任务保持「待甲方质检」(CLIENT_QA)，体现验收尚未完成
}

// 任务自动验收时，同步最新提交记录的质检结果
function markAcceptedSubmission(taskId) {
  const latest = submissions.filter(s => s.taskId === taskId).at(-1)
  if (latest && latest.pass === null) {
    latest.pass = true
    latest.result = '验收通过'
    latest.qaReport = true
    latest.score = latest.score ?? 100
    latest.reviewComment = latest.reviewComment || '质检通过'
  }
  import('./settlement.js').then(m => m.autoGenerateSettlement(taskId, '系统')).catch(() => {})
}

// 明细级状态机（PRD 3.1 映射）：
// pending(待标注) -> annotating(标注中) -> annotated(待供应商质检)
//   -> vendor_passed(待甲方质检) -> accepted(已验收)
// 任意质检驳回 -> rework(返工, IS_REWORK=true) -> 重新提交
export const ITEM_STATUS_MAP = {
  pending: '待标注', annotating: '标注中', annotated: '待供应商质检',
  submitted: '已提交',
  vendor_passed: '待甲方质检', accepted: '已验收', rework: '返工中',
  rejected: '返工中', failed: '失败'
}

const VALID_ERROR_TYPES = ERROR_TYPES.map(t => t.value)

function findTask(taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  return task
}

function findItem(itemId) {
  const item = taskItems.find(i => i.id === itemId)
  if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', '数据明细不存在')
  return item
}

// 数据隔离：供应商角色仅能访问本供应商任务（PRD 2 竞合隔离）
function ensureSupplierScope(user, task) {
  const supplierRoles = [3, 4]
  if (supplierRoles.includes(user.roleType) && task.supplierId !== user.supplierId) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问其他供应商的数据')
  }
}

function addHistory(item, user, action, extra = {}) {
  if (!Array.isArray(item.history)) item.history = []
  item.history.push({ time: nowText(), actor: user.userName, action, ...extra })
}

// 作业队列：返工数据置顶（PRD 3.2 优先队列），标注员默认只看自己相关
export function getWorkbenchQueue(user, taskId) {
  const task = findTask(taskId)
  ensureSupplierScope(user, task)
  let items = taskItems.filter(i => i.taskId === taskId)

  if (user.roleType === 4) {
    // 标注员：返工(自己的) + 自己领取的 + 未领取的 pending
    items = items.filter(i =>
      (i.status === 'rework' && i.claimedBy === user.id) ||
      (i.status === 'annotating' && i.claimedBy === user.id) ||
      i.status === 'pending'
    )
  } else if (user.roleType === 3) {
    // 供应商团队长（含质检）：仅见自己领取的质检任务，或未领取的可领取任务
    const qaClaimed = task.qaClaimedBy && task.qaClaimedBy !== user.id
    if (qaClaimed) {
      // 被他人领取的任务：不展示待检明细（避免重复质检）
      items = []
    } else {
      items = items.filter(i => ['annotated', 'rework'].includes(i.status))
    }
  } else if (user.roleType === 2) {
    // 甲方质检：全量显示「已提交(submitted)」与「待甲方质检(vendor_passed)」明细（不做抽样）
    items = items.filter(i => ['submitted', 'vendor_passed'].includes(i.status))
  } else if (user.roleType === 6) {
    // 算法工程师：仅见甲方验收通过的数据（数据流：标注员→供应商→甲方→算法）
    items = items.filter(i => i.status === 'accepted')
  }

  const sorted = items.slice().sort((a, b) => {
    // IS_REWORK 置顶，分钟级响应
    if (!!b.isRework - !!a.isRework) return (!!b.isRework) - (!!a.isRework)
    return a.id - b.id
  })
  return {
    task: { id: task.id, taskName: task.taskName, annotateType: task.annotateType, qaStandard: task.qaStandard, labels: task.labels || ['车辆', '行人', '骑行者', '交通标志'], unitPrice: task.unitPrice, state: task.state, supplierName: task.supplierName, qaClaimedBy: task.qaClaimedBy || null, qaClaimedByName: task.qaClaimedByName || '' },
    items: sorted,
    statusMap: ITEM_STATUS_MAP,
    submissions: submissions.filter(s => s.taskId === taskId).map(s => ({
      id: s.id, version: s.version, submitTime: s.submitTime, submitUser: s.submitUser,
      pass: s.pass, score: s.score, reviewComment: s.reviewComment,
      itemsSnapshot: s.itemsSnapshot || []
    }))
  }
}

// 领取数据（标注员）
export function claimItem(user, itemId) {
  if (user.roleType !== 4) throw new ApiError(403, 'FORBIDDEN', '仅标注员可领取')
  const item = findItem(itemId)
  const task = findTask(item.taskId)
  ensureSupplierScope(user, task)
  if (!['pending', 'rework'].includes(item.status)) throw new ApiError(409, 'STATE_CONFLICT', '该数据不可领取')
  if (item.status === 'pending' && item.claimedBy && item.claimedBy !== user.id) throw new ApiError(409, 'STATE_CONFLICT', '该数据已被他人领取')
  item.status = item.isRework ? 'rework' : 'annotating'
  if (item.status === 'rework' && item.claimedBy !== user.id) {
    // 返工数据优先回到原标注员；若他人主动领取也允许
    item.claimedBy = user.id
  } else if (!item.claimedBy) {
    item.claimedBy = user.id
  }
  item.annotator = user.userName
  addHistory(item, user, 'claim')
  auditLogs.push({ action: 'item.claim', actorId: user.id, itemId, at: nowText() })
  return item
}

// 质检员领取任务（任务级锁定：一人领取后其他质检员不可同时质检）
export function claimQaTask(user, taskId) {
  if (user.roleType !== 3) throw new ApiError(403, 'FORBIDDEN', '仅供应商质检员可领取质检任务')
  const task = findTask(taskId)
  ensureSupplierScope(user, task)
  if (task.state !== 'VENDOR_QA') throw new ApiError(409, 'STATE_CONFLICT', '仅待质检任务可领取')
  if (task.qaClaimedBy && task.qaClaimedBy !== user.id) {
    throw new ApiError(409, 'STATE_CONFLICT', '该任务已被其他质检员领取')
  }
  task.qaClaimedBy = user.id
  task.qaClaimedByName = user.userName
  task.qaClaimedAt = nowText()
  taskLogs.push({ taskId, time: nowText(), content: user.userName + ' 领取了质检任务', type: 'primary' })
  auditLogs.push({ action: 'task.qaClaim', actorId: user.id, taskId, at: nowText() })
  return task
}

// 释放质检任务（领取人自己释放）
export function releaseQaTask(user, taskId) {
  if (user.roleType !== 3) throw new ApiError(403, 'FORBIDDEN', '仅供应商质检员可操作')
  const task = findTask(taskId)
  ensureSupplierScope(user, task)
  if (task.qaClaimedBy && task.qaClaimedBy !== user.id) {
    throw new ApiError(409, 'STATE_CONFLICT', '该任务已被其他质检员领取，无法释放')
  }
  delete task.qaClaimedBy
  delete task.qaClaimedByName
  delete task.qaClaimedAt
  taskLogs.push({ taskId, time: nowText(), content: user.userName + ' 释放了质检任务', type: 'warning' })
  auditLogs.push({ action: 'task.qaRelease', actorId: user.id, taskId, at: nowText() })
  return task
}

// 保存标注结果（本地自动暂存的服务端落盘，不改状态）
export function saveAnnotation(user, itemId, body) {
  const item = findItem(itemId)
  const task = findTask(item.taskId)
  ensureSupplierScope(user, task)
  if (user.roleType === 4 && item.claimedBy && item.claimedBy !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', '仅领取人可保存该数据')
  }
  const boxes = body && Array.isArray(body.boxes) ? body.boxes : null
  if (!boxes) throw new ApiError(422, 'VALIDATION_ERROR', '标注数据格式不正确')
  item.annotation = {
    boxes: boxes.slice(0, 500).map(b => ({
      x: Math.round(Number(b.x) || 0), y: Math.round(Number(b.y) || 0),
      w: Math.round(Number(b.w) || 0), h: Math.round(Number(b.h) || 0),
      label: String(b.label || '').slice(0, 32)
    })).filter(b => b.w > 2 && b.h > 2)
  }
  item.savedAt = nowText()
  return { saved: true, boxCount: item.annotation.boxes.length }
}

// 标注员提交 -> 进入供应商质检
export function submitItem(user, itemId) {
  if (user.roleType !== 4) throw new ApiError(403, 'FORBIDDEN', '仅标注员可提交')
  const item = findItem(itemId)
  const task = findTask(item.taskId)
  ensureSupplierScope(user, task)
  if (!['annotating', 'rework'].includes(item.status)) throw new ApiError(409, 'STATE_CONFLICT', '当前状态不可提交')
  if (!item.annotation || !item.annotation.boxes || item.annotation.boxes.length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请先完成标注再提交')
  }
  const wasRework = item.status === 'rework'
  item.status = 'annotated'
  item.isRework = false
  item.submitCount = (item.submitCount || 0) + 1
  item.annotator = user.userName
  addHistory(item, user, wasRework ? 'rework_submit' : 'submit')
  auditLogs.push({ action: 'item.submit', actorId: user.id, itemId, at: nowText() })
  autoAdvanceTask(item.taskId)
  return item
}

function qaReview(user, itemId, body, level) {
  const item = findItem(itemId)
  const task = findTask(item.taskId)
  ensureSupplierScope(user, task)
  const isVendor = level === 'vendor'
  // 返工(rework)数据可被质检再次处理：供应商重新内审 or 甲方重新验收
  // 甲方可验收：已提交(submitted)/待甲方质检(vendor_passed)/返工(rework)
  const expectStatus = isVendor ? 'annotated' : ['submitted', 'vendor_passed']
  const expectOk = Array.isArray(expectStatus) ? expectStatus.includes(item.status) : item.status === expectStatus
  if (!expectOk && item.status !== 'rework') {
    throw new ApiError(409, 'STATE_CONFLICT', '当前状态不可质检')
  }
  if (item.status === 'rework') item.isRework = true

  const pass = Boolean(body.pass)
  if (pass) {
    if (isVendor) {
      item.status = 'vendor_passed'
      item.isRework = false
      item.errorTypes = []
      item.rejectNote = ''
    } else {
      item.status = 'accepted'
      item.clientReviewed = true
      item.firstPass = (item.reworkCount || 0) === 0
      // QA 抽检通过后，同任务其他 vendor_passed 项自动通过（未抽中的视为通过）
      const otherItems = taskItems.filter(i => i.taskId === item.taskId && i.status === 'vendor_passed')
      otherItems.forEach(i => { i.status = 'accepted'; i.clientReviewed = true; i.firstPass = (i.reworkCount || 0) === 0 })
    }
    item.errorTypes = []
    item.rejectNote = ''
    addHistory(item, user, isVendor ? 'vendor_pass' : 'client_pass')
    autoAdvanceTask(item.taskId)
  } else {
    // 供应商无驳回权限，驳回仅甲方可操作
    if (isVendor) throw new ApiError(403, 'FORBIDDEN', '供应商无驳回权限，驳回仅甲方可操作')
    const errorTypes = Array.isArray(body.errorTypes) ? body.errorTypes.filter(t => VALID_ERROR_TYPES.includes(t)) : []
    const note = String(body.note || '').trim()
    if (errorTypes.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', '驳回时必须勾选错误分类')
    if (note.length < 2) throw new ApiError(422, 'VALIDATION_ERROR', '请填写驳回批注')
    // 极速返工流：状态直达 rework 并打 IS_REWORK 标记（PRD 3.2）
    item.status = 'rework'
    item.isRework = true
    item.errorTypes = errorTypes
    item.rejectNote = note
    saveRejectImages(item, body.images)
    item.reworkCount = (item.reworkCount || 0) + 1
    if (!isVendor) {
      item.clientReviewed = true
      if (item.firstPass === null) item.firstPass = false
      if (item.reworkCount > 0) item.firstPass = false
    }
    addHistory(item, user, isVendor ? 'vendor_reject' : 'client_reject', { note, errorTypes })
  }
  auditLogs.push({ action: isVendor ? 'item.vendorQa' : 'item.clientQa', actorId: user.id, itemId, pass, at: nowText() })
  return item
}

// 供应商团队长（含质检）一审
export function vendorQaItem(user, itemId, body) {
  if (user.roleType !== 3) throw new ApiError(403, 'FORBIDDEN', '仅供应商团队长可操作')
  const item = findItem(itemId)
  const task = findTask(item.taskId)
  // 质检领取锁定：被他人领取的任务不可质检
  if (task.qaClaimedBy && task.qaClaimedBy !== user.id) {
    throw new ApiError(409, 'STATE_CONFLICT', '该质检任务已被其他质检员领取，无法操作')
  }
  return qaReview(user, itemId, body, 'vendor')
}

// 甲方质检员 验收
export function clientQaItem(user, itemId, body) {
  if (![1, 2].includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅甲方质检可操作')
  const item = qaReview(user, itemId, body, 'client')
  // 甲方单条验收：任务状态由 autoAdvanceTask 根据全部明细进度决定（全部验收完才 ACCEPTED）
  if (body.pass) {
    // 同步更新提交记录的质检结果
    const latest = submissions.filter(s => s.taskId === item.taskId).at(-1)
    if (latest) {
      latest.pass = true
      latest.result = '验收通过'
      latest.qaReport = true
      latest.score = body.score !== undefined ? Number(body.score) : (latest.score ?? 100)
      latest.reviewComment = String(body.note || body.comment || '').trim() || latest.reviewComment || '质检通过'
    }
  }
  return item
}

// 批量质检（PRD 4.2 批量驳回）
export function batchQaItems(user, body, level) {
  const ids = Array.isArray(body.itemIds) ? body.itemIds.map(Number) : []
  if (!ids.length) throw new ApiError(422, 'VALIDATION_ERROR', '请选择数据')
  const results = { done: 0, skipped: 0 }
  for (const id of ids) {
    try {
      if (level === 'vendor') vendorQaItem(user, id, body)
      else clientQaItem(user, id, body)
      results.done++
    } catch { results.skipped++ }
  }
  return results
}
