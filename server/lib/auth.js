import crypto from 'node:crypto'
import { ApiError } from './http.js'
import { config } from '../config.js'
import { users } from '../repositories/data.js'
import { tokenRoles } from './roles.js'

const base64url = input => Buffer.from(input).toString('base64url')
const decode = input => JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))

function sign(data) {
  return crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url')
}

export function issueToken(user) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const { roleType, roleTypes } = tokenRoles(user)
  const payload = {
    sub: String(user.id),
    username: user.username,
    roleType,
    roleTypes,
    iat: now,
    exp: now + config.tokenTtlSeconds
  }
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload))
  return { token: unsigned + '.' + sign(unsigned), expiresIn: config.tokenTtlSeconds }
}

export function verifyToken(token) {
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
  const user = users.find(item => item.id === Number(claims.sub))
  if (!user || user.disabled) throw new ApiError(401, 'UNAUTHORIZED', '用户不可用')
  return user
}

export function requireAuth(req) {
  const authorization = req.headers.authorization || ''
  let token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  // 兼容图片/文件资源：浏览器 <img> 无法携带 Authorization header，允许通过 ?token= 传参
  if (!token && req.url) {
    try {
      const qs = req.url.split('?')[1] || ''
      token = new URLSearchParams(qs).get('token') || ''
    } catch {}
  }
  return verifyToken(token)
}
