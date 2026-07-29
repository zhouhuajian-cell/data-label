import crypto from 'node:crypto'
import { issueToken } from '../lib/auth.js'
import { ApiError } from '../lib/http.js'
import { auditLogs } from '../repositories/data.js'
import { loginByFeishuCode } from './auth.js'

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
