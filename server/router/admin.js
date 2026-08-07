// 管理路由（需鉴权）：用户管理、系统日志、消息通知、飞书 webhook
import { config } from '../config.js'
import { created, ok, readJson } from '../lib/http.js'
import { listAuditLogs } from '../services/logs.js'
import { getNotifications, markRead, markAllRead } from '../services/notifications.js'
import { getWebhookConfig, setWebhookConfig, sendFeishu, pushProjectSummary } from '../services/feishu.js'

export async function adminRouter(ctx) {
  const { req, res, url, pathname, user } = ctx
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  // ===== 用户管理 =====
  if (is('GET', '/api/users/me')) {
    ok(res, { userName: user.userName, roleType: user.roleType, supplierId: user.supplierId }); return true
  }
  if (is('GET', '/api/users')) {
    const { listUsers } = await import('../services/users.js')
    ok(res, listUsers(user)); return true
  }
  if (is('POST', '/api/users')) {
    const { createUser } = await import('../services/users.js')
    created(res, createUser(user, await body())); return true
  }

  const userItem = m(/^\/api\/users\/(\d+)$/)
  if (userItem && req.method === 'PUT') {
    const { updateUser } = await import('../services/users.js')
    ok(res, updateUser(user, Number(userItem[1]), await body())); return true
  }
  if (userItem && req.method === 'DELETE') {
    const { deleteUser } = await import('../services/users.js')
    ok(res, deleteUser(user, Number(userItem[1]))); return true
  }

  // ===== 系统日志 =====
  if (is('GET', '/api/admin/logs')) {
    const { items, total } = listAuditLogs(user, url.searchParams)
    ok(res, items, { total }); return true
  }

  // ===== 消息通知 =====
  if (is('GET', '/api/notifications')) {
    const result = getNotifications(user, url.searchParams)
    ok(res, result.items, { total: result.total, unread: result.unread }); return true
  }

  const notifRead = m(/^\/api\/notifications\/(\d+)\/read$/)
  if (notifRead && req.method === 'PUT') { ok(res, markRead(user, Number(notifRead[1]))); return true }

  if (is('PUT', '/api/notifications/read-all')) { ok(res, markAllRead(user)); return true }

  // ===== 飞书 Webhook =====
  if (is('GET', '/api/feishu/webhook')) { ok(res, getWebhookConfig(user)); return true }
  if (is('POST', '/api/feishu/webhook')) { ok(res, setWebhookConfig(user, await body())); return true }

  if (is('POST', '/api/feishu/push')) {
    const b = await body()
    const cfg = getWebhookConfig(user)
    const targetIndex = b.webhookIndex !== undefined ? Number(b.webhookIndex) : -1
    const targets = targetIndex >= 0 && targetIndex < cfg.webhooks.length ? [cfg.webhooks[targetIndex].url] : null
    try {
      ok(res, await sendFeishu(b.title || '手动推送', b.content || '来自数据平台的消息', targets))
    } catch (e) {
      ok(res, { sent: false, reason: e.message })
    }
    return true
  }

  const projectSummary = m(/^\/api\/feishu\/project-summary\/(\d+)$/)
  if (projectSummary && req.method === 'POST') {
    ok(res, await pushProjectSummary(user, Number(projectSummary[1]))); return true
  }
  return false
}
