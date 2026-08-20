// GND 域独立 JWT 签发/校验（与旧业务 users 完全隔离，payload 带 domain:'gnd'）
import crypto from 'node:crypto'
import { ApiError } from './http.js'
import { config } from '../config.js'
import { gndUsers } from '../repositories/data.js'

const base64url = input => Buffer.from(input).toString('base64url')
const decode = input => JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))

function sign(data) {
  return crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url')
}

export function gndIssueToken(user) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: String(user.id),
    username: user.username,
    roleType: user.roleType,
    supplierId: user.supplierId,
    domain: 'gnd',
    iat: now,
    exp: now + config.tokenTtlSeconds
  }
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload))
  return { token: unsigned + '.' + sign(unsigned), expiresIn: config.tokenTtlSeconds }
}

export function gndVerifyToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new ApiError(401, 'UNAUTHORIZED', '请先登录')
  const [header, payload, signature] = parts
  const unsigned = header + '.' + payload
  const expected = sign(unsigned)
  const signatureBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    throw new ApiError(401, 'UNAUTHORIZED', '登录态无效')
  }
  let claims
  try {
    claims = decode(payload)
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', '登录态无效')
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'TOKEN_EXPIRED', '登录态已过期')
  }
  if (claims.domain !== 'gnd') throw new ApiError(401, 'UNAUTHORIZED', '登录态无效')
  const user = gndUsers.find(u => u.id === Number(claims.sub))
  if (!user || user.status === 'DISABLED' || user.status === 'REJECTED') {
    throw new ApiError(401, 'UNAUTHORIZED', '用户不可用')
  }
  return user
}

export function gndRequireAuth(req) {
  const authorization = req.headers.authorization || ''
  let token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token && req.url) {
    try {
      token = new URLSearchParams((req.url.split('?')[1] || '')).get('token') || ''
    } catch {}
  }
  return gndVerifyToken(token)
}

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex')
}
