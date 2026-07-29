import { ApiError } from '../lib/http.js'
import { tasks, taskItems, auditLogs, ERROR_TYPES, submissions } from '../repositories/data.js'
import { createNotification } from './notifications.js'
import { nowText } from '../lib/time.js'

// 明细级状态机（PRD 3.1 映射）：
// pending(待标注) -> annotating(标注中) -> annotated(待供应商质检)
//   -> vendor_passed(待甲方质检) -> accepted(已验收)
// 任意质检驳回 -> rework(返工, IS_REWORK=true) -> 重新提交
export const ITEM_STATUS_MAP = {
  pending: '待标注', annotating: '标注中', annotated: '待供应商质检',
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
  const supplierRoles = [3, 4, 5]
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
  } else if (user.roleType === 5) {
    items = items.filter(i => ['annotated', 'rework'].includes(i.status))
  } else if (user.roleType === 2) {
    items = items.filter(i => i.status === 'vendor_passed')
    // QA 抽检率：按配置比例随机抽取（超时未抽中的自动通过）
    const rate = task.qaSamplingRate != null ? Number(task.qaSamplingRate) : 1.0
    if (rate < 1.0 && items.length > 1) {
      const seed = task.id * 7919 + 271828 // 稳定种子保证同任务多次刷新一致
      const shuffled = items.slice().sort((a, b) => {
        return ((seed * (a.id + 1) * 9301) % 233280) - ((seed * (b.id + 1) * 9301) % 233280)
      })
      const sampleSize = Math.max(1, Math.ceil(items.length * rate))
      const sampled = new Set(shuffled.slice(0, sampleSize).map(i => i.id))
      items = items.filter(i => sampled.has(i.id))
    }
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
    task: { id: task.id, taskName: task.taskName, annotateType: task.annotateType, qaStandard: task.qaStandard, labels: task.labels || ['车辆', '行人', '骑行者', '交通标志'], unitPrice: task.unitPrice, state: task.state, supplierName: task.supplierName },
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
  createNotification(null, 'qa', '数据提交待检', `${user.userName} 已提交「${item.itemName}」的标注结果，请供应商质检员核查`, 'item', item.id)
  return item
}

function qaReview(user, itemId, body, level) {
  const item = findItem(itemId)
  const task = findTask(item.taskId)
  ensureSupplierScope(user, task)
  const isVendor = level === 'vendor'
  const expectStatus = isVendor ? 'annotated' : 'vendor_passed'
  if (item.status !== expectStatus) throw new ApiError(409, 'STATE_CONFLICT', '当前状态不可质检')

  const pass = Boolean(body.pass)
  if (pass) {
    if (isVendor) {
      item.status = 'vendor_passed'
    } else {
      item.status = 'accepted'
      item.clientReviewed = true
      // 一次通过：从未返工且供应商质检也未驳回过
      item.firstPass = (item.reworkCount || 0) === 0
    }
    item.errorTypes = []
    item.rejectNote = ''
    addHistory(item, user, isVendor ? 'vendor_pass' : 'client_pass')
  } else {
    const errorTypes = Array.isArray(body.errorTypes) ? body.errorTypes.filter(t => VALID_ERROR_TYPES.includes(t)) : []
    const note = String(body.note || '').trim()
    if (errorTypes.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', '驳回时必须勾选错误分类')
    if (note.length < 2) throw new ApiError(422, 'VALIDATION_ERROR', '请填写驳回批注')
    // 极速返工流：状态直达 rework 并打 IS_REWORK 标记（PRD 3.2）
    item.status = 'rework'
    item.isRework = true
    item.errorTypes = errorTypes
    item.rejectNote = note
    item.reworkCount = (item.reworkCount || 0) + 1
    if (!isVendor) {
      item.clientReviewed = true
      if (item.firstPass === null) item.firstPass = false
      if (item.reworkCount > 0) item.firstPass = false
    }
    addHistory(item, user, isVendor ? 'vendor_reject' : 'client_reject', { note, errorTypes })
    const rejectSource = isVendor ? '供应商质检' : '甲方质检'
    createNotification(null, 'qa', `${rejectSource}驳回`, `${user.userName} 驳回了「${item.itemName}」：${note}`, 'item', item.id)
  }
  auditLogs.push({ action: isVendor ? 'item.vendorQa' : 'item.clientQa', actorId: user.id, itemId, pass, at: nowText() })
  return item
}

// 供应商质检员 一审
export function vendorQaItem(user, itemId, body) {
  if (user.roleType !== 5) throw new ApiError(403, 'FORBIDDEN', '仅供应商质检员可操作')
  return qaReview(user, itemId, body, 'vendor')
}

// 甲方质检员 验收
export function clientQaItem(user, itemId, body) {
  if (![1, 2].includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅甲方质检可操作')
  return qaReview(user, itemId, body, 'client')
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
