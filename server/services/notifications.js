import { notifications, users, auditLogs } from '../repositories/data.js'
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { hasAnyRole } from '../lib/roles.js'
import { enqueueFeishu } from './feishu.js'

// 创建通知：推送给指定的用户或角色范围
export function createNotification(targetUserIds, type, title, content, refType, refId) {
  const ids = Array.isArray(targetUserIds) ? targetUserIds : (targetUserIds ? [targetUserIds] : [])
  const note = {
    id: Math.max(...notifications.map(n => n.id), 0) + 1,
    userIds: ids,
    type, title, content,
    refType: refType || '', refId: refId || 0,
    read: false,
    createdAt: nowText()
  }
  notifications.push(note)
  // 自动推送飞书（入串行队列，限速+重试，不阻塞主流程）；落投递审计便于在「系统日志」核对
  enqueueFeishu(title, content)
    .then(res => {
      auditLogs.push({
        action: 'feishu.push', actorId: null, ok: !!res.sent,
        title, reason: res.sent ? '' : (res.reason || (res.results || []).map(r => r.resp).join('; ')).slice(0, 200),
        at: nowText()
      })
    })
    .catch(err => {
      auditLogs.push({ action: 'feishu.push', actorId: null, ok: false, title, reason: String(err.message || err).slice(0, 200), at: nowText() })
    })
  return note
}

// 把某单据给指定用户的未读提醒标记为已读（改派时清掉原处理人手里的待办）
export function markRefReadForUsers(refType, refId, userIds) {
  const ids = (userIds || []).map(Number).filter(Boolean)
  if (!ids.length) return 0
  let n = 0
  for (const note of notifications) {
    if (note.read) continue
    if (note.refType !== refType) continue
    if (Number(note.refId) !== Number(refId)) continue
    if (!note.userIds.some(id => ids.includes(Number(id)))) continue
    note.read = true
    n++
  }
  return n
}

// 获取用户通知
export function getNotifications(user, query) {
  let list = notifications.filter(n => n.userIds.length === 0 || n.userIds.includes(user.id))
  const filterType = String(query.get('type') || '').trim()
  if (filterType && filterType !== 'all') {
    list = list.filter(n => n.type === filterType)
  }
  const unreadOnly = query.get('unread') === '1'
  if (unreadOnly) list = list.filter(n => !n.read)

  list = list.slice().sort((a, b) => b.id - a.id)
  const page = Math.max(Number(query.get('page') || 1), 1)
  const pageSize = Math.min(Math.max(Number(query.get('pageSize') || 15), 1), 100)
  const start = (page - 1) * pageSize
  return { items: list.slice(start, start + pageSize), total: list.length, unread: notifications.filter(n => (n.userIds.length === 0 || n.userIds.includes(user.id)) && !n.read).length }
}

// 标记单条已读
export function markRead(user, id) {
  const note = notifications.find(n => n.id === id && (n.userIds.length === 0 || n.userIds.includes(user.id)))
  if (!note) throw new ApiError(404, 'NOT_FOUND', '通知不存在')
  note.read = true
  return note
}

// 全部已读
export function markAllRead(user) {
  let count = 0
  notifications.forEach(n => {
    if ((n.userIds.length === 0 || n.userIds.includes(user.id)) && !n.read) {
      n.read = true; count++
    }
  })
  return { read: count }
}

// 批量创建通知：仅按角色找目标用户（不受 supplierId 限制，用于跨角色的流程节点提醒）
// 账号可持多角色，命中任一角色即推送
export function notifyRoles(roles, type, title, content, refType, refId) {
  const ids = users.filter(u => !u.disabled && hasAnyRole(u, roles)).map(u => u.id)
  return createNotification(ids, type, title, content, refType, refId)
}

// 批量创建通知：按角色+供应商ID找目标用户
export function notifyByRole(supplierName, roles, type, title, content, refType, refId) {
  const wanted = String(supplierName || '').trim()
  const targets = users.filter(u => {
    if (!hasAnyRole(u, roles)) return false
    if (wanted && String(u.userName || '').trim() !== wanted) return false
    return true
  })
  const ids = targets.map(u => u.id)
  return createNotification(ids, type, title, content, refType, refId)
}
