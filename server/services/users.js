import { users } from '../repositories/data.js'
import { ApiError } from '../lib/http.js'
import { normalizeRoleTypes, roleTypesOf } from '../lib/roles.js'
import { resetPassword, PASSWORD_MIN_LENGTH } from './auth.js'
import { hashPassword } from '../lib/password.js'
import { writeAudit, changedFields } from '../lib/audit.js'

// 管理员新建/重置账号的默认初始密码（首次登录强制修改）
export const DEFAULT_PASSWORD = '123456'

function requirePM(user) {
  if (!roleTypesOf(user).includes(1)) throw new ApiError(403, 'FORBIDDEN', '仅管理员可管理用户')
}

function toSafeUser(u) {
  // 注意：绝不返回 password / passwordHash
  return {
    id: u.id, username: u.username, userName: u.userName,
    roleType: roleTypesOf(u)[0], roleTypes: roleTypesOf(u),
    disabled: u.disabled,
    mustChangePassword: !!u.mustChangePassword,
    passwordUpdatedAt: u.passwordUpdatedAt || null
  }
}

export function listUsers(user) {
  requirePM(user)
  return users.map(toSafeUser)
}

export function createUser(user, body) {
  requirePM(user)
  const username = String(body.username || '').trim()
  const userName = String(body.userName || body.name || username).trim()
  const password = String(body.password || '').trim()
  if (!username) throw new ApiError(422, 'VALIDATION_ERROR', '请输入手机号/账号')
  if (users.find(u => u.username === username)) throw new ApiError(409, 'STATE_CONFLICT', '账号已存在')
  if (password && password.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(422, 'VALIDATION_ERROR', `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  }
  // 多角色：roleTypes 优先，缺省时退回单个 roleType
  const roleTypes = normalizeRoleTypes(body.roleTypes, body.roleType)
  const newUser = {
    id: Math.max(...users.map(u => u.id), 0) + 1,
    username,
    passwordHash: hashPassword(password || DEFAULT_PASSWORD),
    userName,
    roleType: roleTypes[0],
    roleTypes,
    disabled: false,
    // 管理员代设的初始密码一律要求首次登录后改密
    mustChangePassword: true
  }
  users.push(newUser)
  writeAudit('user.create', user, newUser, { username, userName, roleTypes })
  return toSafeUser(newUser)
}

export function updateUser(user, id, body) {
  requirePM(user)
  const u = users.find(item => item.id === id)
  if (!u) throw new ApiError(404, 'NOT_FOUND', '用户不存在')
  // 变更前快照：用于审计里对比出「到底改了什么」
  const before = { username: u.username, userName: u.userName, disabled: !!u.disabled, roleTypes: roleTypesOf(u) }
  // 允许修改登录账号（管理员权限）：需保持唯一
  if (body.username !== undefined) {
    const username = String(body.username).trim()
    if (!username) throw new ApiError(422, 'VALIDATION_ERROR', '登录账号不能为空')
    if (username !== u.username && users.some(x => x.username === username)) {
      throw new ApiError(409, 'STATE_CONFLICT', '账号已存在')
    }
    u.username = username
  }
  if (body.userName !== undefined) u.userName = String(body.userName).trim()
  if (body.disabled !== undefined) u.disabled = !!body.disabled
  // 统一结算方（柏川）：抄送待办直达该账号
  if (body.isSettlementParty !== undefined) u.isSettlementParty = !!body.isSettlementParty
  // 管理员可免除/恢复"首次登录强制改密"
  if (body.mustChangePassword !== undefined) u.mustChangePassword = !!body.mustChangePassword
  if (body.roleTypes !== undefined || body.roleType !== undefined) {
    const roleTypes = normalizeRoleTypes(body.roleTypes, body.roleType)
    u.roleTypes = roleTypes
    u.roleType = roleTypes[0]
  }
  // 密码通过独立入口重置（会置为"下次登录必须改密"）
  if (body.password !== undefined && String(body.password).trim()) {
    resetPassword(user, id, body.password)
  }
  const after = { username: u.username, userName: u.userName, disabled: !!u.disabled, roleTypes: roleTypesOf(u) }
  // 审计：记录改了哪些字段与前后值（角色、姓名、账号、启用状态等）
  const changed = changedFields(before, after)
  if (changed.length) {
    writeAudit('user.update', user, u, {
      changed,
      before: Object.fromEntries(changed.map(k => [k, before[k]])),
      after: Object.fromEntries(changed.map(k => [k, after[k]]))
    })
  }
  return toSafeUser(u)
}

// 停用账号（保留数据，可再启用）
export function disableUser(user, id) {
  requirePM(user)
  const u = users.find(item => item.id === id)
  if (!u) throw new ApiError(404, 'NOT_FOUND', '用户不存在')
  if (u.id === user.id) throw new ApiError(422, 'VALIDATION_ERROR', '不能停用当前登录账号')
  u.disabled = true
  writeAudit('user.disable', user, u, { note: '停用账号（保留数据，可再启用）' })
  return { disabled: true }
}

// 彻底删除账号（不可恢复，从账号名册移除）。
// 安全约束：不能删自己；不能删掉最后一个启用中的管理员（否则没人能再进管理页）。
// 单据与日志仍保留：日志里的操作人姓名是冗余存储的，被删账号的历史记录照样可读。
export function removeUser(user, id) {
  requirePM(user)
  const idx = users.findIndex(item => item.id === id)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '用户不存在')
  const target = users[idx]
  if (target.id === user.id) throw new ApiError(422, 'VALIDATION_ERROR', '不能删除当前登录账号')
  // 防御性校验：删人者自己必须是管理员（requirePM 已保证），因此当他是唯一管理员时
  // 会先撞到上面的「不能删自己」；这条保护只在将来放开删除权限时才可能生效
  if (roleTypesOf(target).includes(1)) {
    const otherAdmins = users.filter(u => u.id !== target.id && !u.disabled && roleTypesOf(u).includes(1))
    if (!otherAdmins.length) {
      throw new ApiError(422, 'VALIDATION_ERROR', '不能删除最后一个管理员账号，请先指定其他管理员')
    }
  }
  const snapshot = { username: target.username, userName: target.userName, roleTypes: roleTypesOf(target), disabled: !!target.disabled }
  users.splice(idx, 1)
  writeAudit('user.delete', user, target, { ...snapshot, note: '彻底删除账号（不可恢复）' })
  return { deleted: true, removed: snapshot }
}

// 管理员重置密码（被重置账号下次登录必须改密）
export function adminResetPassword(actor, id, newPassword) {
  requirePM(actor)
  return resetPassword(actor, id, newPassword)
}
