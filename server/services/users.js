import { users } from '../repositories/data.js'
import { ApiError } from '../lib/http.js'

function requirePM(user) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM可管理用户')
}

export function listUsers(user) {
  requirePM(user)
  return users.map(u => ({ id: u.id, username: u.username, userName: u.userName, roleType: u.roleType, supplierId: u.supplierId, disabled: u.disabled }))
}

export function createUser(user, body) {
  requirePM(user)
  const username = String(body.username || '').trim()
  const userName = String(body.userName || body.name || username).trim()
  const password = String(body.password || '123').trim()
  const roleType = Number(body.roleType || 4)
  const supplierId = body.supplierId ? Number(body.supplierId) : null
  if (!username) throw new ApiError(422, 'VALIDATION_ERROR', '请输入手机号/账号')
  if (users.find(u => u.username === username)) throw new ApiError(409, 'STATE_CONFLICT', '账号已存在')
  const newUser = { id: Math.max(...users.map(u => u.id), 0) + 1, username, password, userName, roleType, supplierId, disabled: false }
  users.push(newUser)
  return newUser
}

export function updateUser(user, id, body) {
  requirePM(user)
  const u = users.find(u => u.id === id)
  if (!u) throw new ApiError(404, 'NOT_FOUND', '用户不存在')
  if (body.userName !== undefined) u.userName = String(body.userName).trim()
  if (body.password !== undefined) u.password = String(body.password)
  if (body.roleType !== undefined) u.roleType = Number(body.roleType)
  if (body.supplierId !== undefined) u.supplierId = body.supplierId ? Number(body.supplierId) : null
  if (body.disabled !== undefined) u.disabled = !!body.disabled
  return u
}

export function deleteUser(user, id) {
  requirePM(user)
  const u = users.find(u => u.id === id)
  if (!u) throw new ApiError(404, 'NOT_FOUND', '用户不存在')
  u.disabled = true
  return { deleted: true }
}
