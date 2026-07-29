import { notifications, users } from '../repositories/data.js'
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'

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
  return note
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

// 批量创建通知：按角色+供应商ID找目标用户
export function notifyByRole(supplierId, roles, type, title, content, refType, refId) {
  const targets = users.filter(u => {
    if (!roles.includes(u.roleType)) return false
    if (supplierId !== null && u.supplierId !== supplierId) return false
    // 甲方角色（角色 1,2,6）不受 supplierId 限制
    if ([1, 2, 6].includes(u.roleType)) return true
    return true
  })
  const ids = targets.map(u => u.id)
  return createNotification(ids, type, title, content, refType, refId)
}
