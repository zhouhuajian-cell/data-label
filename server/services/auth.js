import { ApiError } from '../lib/http.js'
import { users } from '../repositories/data.js'
import { nowText } from '../lib/time.js'
import { normalizeRoleTypes } from '../lib/roles.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { writeAudit } from '../lib/audit.js'

// 飞书登录 MVP：授权码 → 账号（真实飞书 OAuth 二期接入，见 README）
const feishuMap = {
  'feishu-admin': 'taixing',
  'feishu-qa': 'qa_01',
  'feishu-suppa': 'supp_a',
  'feishu-suppb': 'supp_b'
}

export const PASSWORD_MIN_LENGTH = 6

export function loginByPassword(body) {
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  // 先按账号取出再校验哈希：避免"用户不存在"与"密码错误"产生不同的响应耗时
  const user = users.find(item => item.username === username && !item.disabled)
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    // 失败也记一笔（便于排查异常登录尝试），但只留账号不留密码
    writeAudit('auth.loginFail', null, null, { username, actorName: '未登录' })
    throw new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
  }
  writeAudit('auth.login', user, null, { username })
  return user
}

export function loginByFeishuCode(body) {
  const code = String(body.code || '').trim()
  if (!code) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请提供飞书授权码')
  }
  const username = feishuMap[code]
  if (!username) {
    throw new ApiError(401, 'INVALID_FEISHU_CODE', '飞书授权码无效')
  }
  const user = users.find(item => item.username === username && !item.disabled)
  if (!user) {
    throw new ApiError(401, 'USER_NOT_FOUND', '对应用户不存在或已停用')
  }
  writeAudit('auth.login', user, null, { username, method: 'feishu' })
  return user
}

// 本人修改密码：需校验原密码；改密后清除"首登强制改密"标记
export function changeOwnPassword(user, body) {
  const oldPassword = String(body.oldPassword || '')
  const newPassword = String(body.newPassword || '')
  if (!oldPassword || !newPassword) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请填写原密码与新密码')
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(422, 'VALIDATION_ERROR', `新密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  }
  if (newPassword === oldPassword) {
    throw new ApiError(422, 'VALIDATION_ERROR', '新密码不能与原密码相同')
  }
  if (!user.passwordHash || !verifyPassword(oldPassword, user.passwordHash)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', '原密码不正确')
  }
  user.passwordHash = hashPassword(newPassword)
  delete user.password // 清掉可能残留的历史明文字段
  user.mustChangePassword = false
  user.passwordUpdatedAt = nowText()
  writeAudit('auth.changePassword', user, null, { note: '本人修改密码' })
  return { changed: true }
}

// 管理员重置他人密码：重置后强制该账号下次登录改密
export function resetPassword(actor, targetId, newPassword) {
  const pwd = String(newPassword || '').trim()
  if (pwd.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(422, 'VALIDATION_ERROR', `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  }
  const target = users.find(u => u.id === targetId)
  if (!target) throw new ApiError(404, 'NOT_FOUND', '用户不存在')
  target.passwordHash = hashPassword(pwd)
  delete target.password
  target.mustChangePassword = true
  target.passwordUpdatedAt = nowText()
  writeAudit('user.resetPassword', actor, target, { note: '重置后需首次登录改密' })
  return { reset: true, mustChangePassword: true }
}

// 供用户管理复用：角色集合校验
export { normalizeRoleTypes }
