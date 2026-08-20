import crypto from 'node:crypto'
import { issueToken } from '../lib/auth.js'
import { ApiError } from '../lib/http.js'
import { auditLogs, feishuConfig } from '../repositories/data.js'
import { loginByFeishuCode } from './auth.js'

// Webhook 消息推送
let pushEnabled = true

export function getWebhookConfig(user) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM可管理')
  return { webhooks: feishuConfig.webhooks, enabled: feishuConfig.enabled }
}

export function setWebhookConfig(user, body) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM可管理')
  if (body.enabled !== undefined) feishuConfig.enabled = !!body.enabled
  if (Array.isArray(body.webhooks)) feishuConfig.webhooks = body.webhooks.map(w => ({ name: String(w.name||'').trim(), url: String(w.url||'').trim() })).filter(w => w.url)
  auditLogs.push({ action: 'feishu.webhook', actorId: user.id, count: feishuConfig.webhooks.length, at: new Date().toISOString() })
  return getWebhookConfig(user)
}

export async function sendFeishu(title, content, targetUrls) {
  const urls = targetUrls || feishuConfig.webhooks.filter(w => w.url).map(w => w.url)
  if (!urls.length || !feishuConfig.enabled) return { sent: false, reason: !urls.length ? '未配置webhook' : '推送已关闭' }
  const results = []
  for (const url of urls) {
    try {
      const payload = { msg_type: 'interactive', card: { header: { title: { tag: 'plain_text', content: title }, template: 'blue' }, elements: [{ tag: 'div', text: { tag: 'lark_md', content } }] } }
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const text = await resp.text()
      let result
      try { result = JSON.parse(text) } catch { result = { raw: text.slice(0, 100) } }
      const ok = resp.status === 200 && (result.StatusCode === 0 || result.code === 0 || text.includes('success') || text === 'ok')
      results.push({ url: url.slice(-30), ok, resp: ok ? 'ok' : (result.StatusMessage || result.msg || result.raw || text.slice(0, 50)) })
    } catch (e) { results.push({ url: url.slice(-30), ok: false, resp: e.message }) }
  }
  return { sent: results.some(r => r.ok), results }
}

// 推送项目摘要到飞书
export async function pushProjectSummary(user, projectId) {
  const { projects, tasks, taskItems } = await import('../repositories/data.js')
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  const projTasks = tasks.filter(t => t.projectId === projectId)
  const stateMap = {}, acceptedCount = projTasks.filter(t => t.state === 'ACCEPTED').length
  projTasks.forEach(t => { stateMap[t.state] = (stateMap[t.state] || 0) + 1 })
  const STATUS_CN = { UNASSIGNED: '待标注', ANNOTATING: '标注中', VENDOR_QA: '供应商质检', CLIENT_QA: '已提交待甲方验收', ACCEPTED: '已验收', REJECTED: '驳回', ARCHIVED: '已归档' }

  const lines = []
  lines.push(`**项目**：${project.name}`)
  lines.push(`**进度**：${acceptedCount}/${projTasks.length} 已验收`)
  lines.push('')
  lines.push('**任务状态分布**：')
  Object.entries(stateMap).forEach(([k, v]) => { lines.push(`- ${STATUS_CN[k] || k}: **${v}** 条`) })
  lines.push('')
  lines.push(`> 推送人：${user.userName} · ${new Date().toLocaleString('zh-CN')}`)

  return sendFeishu(`📊 项目报告：${project.name}`, lines.join('\n'))
}

const sessions = new Map()
const QR_EXPIRE_MS = 3 * 60 * 1000

function nowText() {
  return new Date().toISOString()
}

function getSession(key) {
  const session = sessions.get(key)
  if (!session) {
    throw new ApiError(404, 'FEISHU_SESSION_NOT_FOUND', '未找到扫码会话')
  }

  if (Date.now() > session.expiresAt) {
    session.status = 'expired'
    throw new ApiError(410, 'FEISHU_SESSION_EXPIRED', '扫码会话已过期')
  }

  return session
}

export function createFeishuQrSession() {
  const qrKey = crypto.randomUUID()
  const now = Date.now()
  const session = {
    qrKey,
    status: 'pending',
    createdAt: now,
    expiresAt: now + QR_EXPIRE_MS,
    token: null,
    userInfo: null
  }
  sessions.set(qrKey, session)
  return {
    qrKey,
    qrText: `feishu://login?key=${qrKey}`,
    expiresIn: Math.floor(QR_EXPIRE_MS / 1000)
  }
}

export function pollFeishuSession(qrKey) {
  const session = sessions.get(qrKey)
  if (!session) {
    throw new ApiError(404, 'FEISHU_SESSION_NOT_FOUND', '未找到扫码会话')
  }
  if (Date.now() > session.expiresAt) {
    session.status = 'expired'
  }

  return {
    status: session.status,
    ...(session.status === 'authenticated' ? { token: session.token, userInfo: session.userInfo } : {})
  }
}

export function scanFeishuQr(body) {
  const qrKey = String(body.key || '').trim()
  if (!qrKey) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请提供扫码会话 key')
  }

  const session = getSession(qrKey)
  if (session.status !== 'pending') {
    throw new ApiError(409, 'FEISHU_SESSION_INVALID', '扫码会话不可用')
  }

  const user = loginByFeishuCode(body)
  const { token, expiresIn } = issueToken(user)
  session.status = 'authenticated'
  session.token = token
  session.userInfo = {
    userName: user.userName,
    roleType: user.roleType,
    supplierId: user.supplierId
  }
  auditLogs.push({ action: 'feishu.login', actorId: user.id, at: nowText() })

  return {
    status: session.status,
    token,
    expiresIn,
    userInfo: session.userInfo
  }
}
