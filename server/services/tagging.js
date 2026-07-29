import { tasks, taskItems, scenarioDimensions, auditLogs } from '../repositories/data.js'
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'

// 数据清洗人员 roleType = 7
const CLEANER_ROLE = 7

function requireCleanerOrPM(user) {
  if (![1, 7].includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅数据清洗人员或甲方PM可操作')
}

// 场景维度管理（PM 可增删改）
export function getScenarioDimensions(user) {
  return scenarioDimensions
}

export function saveScenarioDimension(user, body) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM可编辑场景维度')
  const label = String(body.label || '').trim()
  const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string' && t.trim()) : []
  if (!label || !tags.length) throw new ApiError(422, 'VALIDATION_ERROR', '维度和标签不能为空')
  // 更新或新增
  const existing = scenarioDimensions.find(d => d.id === body.id)
  if (existing) {
    existing.label = label
    existing.tags = tags
  } else {
    scenarioDimensions.push({ id: Date.now(), label, tags })
  }
  auditLogs.push({ action: 'scenarioDimension.save', actorId: user.id, label, at: nowText() })
  return scenarioDimensions
}

export function deleteScenarioDimension(user, id) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM可删除场景维度')
  const idx = scenarioDimensions.findIndex(d => d.id === id)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '维度不存在')
  scenarioDimensions.splice(idx, 1)
  auditLogs.push({ action: 'scenarioDimension.delete', actorId: user.id, dimensionId: id, at: nowText() })
  return { deleted: true }
}

// 数据清洗队列
export function getTaggingQueue(user, taskId) {
  requireCleanerOrPM(user)
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'NOT_FOUND', '任务不存在')
  const items = taskItems.filter(i => i.taskId === taskId)
  const total = items.length
  const tagged = items.filter(i => (i.tags || []).length > 0).length
  return {
    task: { id: task.id, taskName: task.taskName, annotateType: task.annotateType, supplierName: task.supplierName },
    dimensions: scenarioDimensions,
    items: items.map(i => ({ id: i.id, itemName: i.itemName, image: i.image, status: i.status, tags: i.tags || [] })),
    progress: { total, tagged }
  }
}

// 保存单条数据的场景标签
export function saveItemTags(user, itemId, body) {
  requireCleanerOrPM(user)
  const item = taskItems.find(i => i.id === itemId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '数据明细不存在')
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : []
  item.tags = tags
  return { id: item.id, tags: item.tags }
}

// 批量打标签
export function batchSaveTags(user, body) {
  requireCleanerOrPM(user)
  const ids = Array.isArray(body.itemIds) ? body.itemIds.map(Number) : []
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : []
  if (!ids.length) throw new ApiError(422, 'VALIDATION_ERROR', '请选择数据')
  let done = 0
  ids.forEach(id => {
    const item = taskItems.find(i => i.id === id)
    if (!item) return
    item.tags = [...tags]
    done++
  })
  return { done }
}
