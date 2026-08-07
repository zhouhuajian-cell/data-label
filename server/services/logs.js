// 系统日志查询（审计日志分页 + 操作人姓名 join）
import { auditLogs, users } from '../repositories/data.js'

export function listAuditLogs(user, searchParams) {
  const page = Math.max(Number(searchParams.get('page') || 1), 1)
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 30), 1), 200)
  const typeFilter = String(searchParams.get('type') || '').trim()
  let list = auditLogs.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
  if (typeFilter) list = list.filter(l => l.action && l.action.includes(typeFilter))
  const total = list.length
  const start = (page - 1) * pageSize
  const items = list.slice(start, start + pageSize).map(l => {
    const u = users.find(x => x.id === l.actorId)
    return { ...l, actorName: u?.userName || '未知' }
  })
  return { items, total }
}
