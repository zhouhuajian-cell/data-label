// GND 认证服务：账号密码登录 / 飞书模拟登录与自注册 / 当前用户 / 改密
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndUsers } from '../repositories/data.js'
import { gndIssueToken, hashPassword } from '../lib/gnd-jwt.js'
import { nextId } from './gnd-common.js'

function toPayload(user) {
  const { token, expiresIn } = gndIssueToken(user)
  return {
    token,
    expiresIn,
    userInfo: { id: user.id, name: user.name, username: user.username, roleType: user.roleType, supplierId: user.supplierId, status: user.status }
  }
}

function assertLoginAllowed(user) {
  if (user.status === 'PENDING') throw new ApiError(403, 'GND_USER_PENDING', '账号待管理员审批')
  if (user.status === 'DISABLED' || user.status === 'REJECTED') throw new ApiError(403, 'GND_USER_DISABLED', '账号不可用')
}

// ===== 账号密码登录（种子账号 gnd_admin 及 MVP 阶段）=====
export function loginByPassword(body) {
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) throw new ApiError(422, 'VALIDATION_ERROR', '账号和密码必填')
  const user = gndUsers.find(u => u.username === username)
  if (!user || user.password !== hashPassword(password)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
  }
  assertLoginAllowed(user)
  return toPayload(user)
}

// ===== 飞书登录 / 注册申请（MVP 模拟：code 即飞书账号标识）=====
export function loginByFeishu(body) {
  const code = String(body.code || '').trim()
  if (!code) throw new ApiError(422, 'VALIDATION_ERROR', '请提供飞书授权码')
  const user = gndUsers.find(u => u.feishuOpenId === code)
  if (user) {
    assertLoginAllowed(user)
    return toPayload(user)
  }
  // 无账号：自注册申请（需提供姓名）
  const name = String(body.name || '').trim()
  if (!name) throw new ApiError(422, 'VALIDATION_ERROR', '首次登录请提供姓名以提交注册申请')
  const dup = gndUsers.some(u => u.feishuOpenId === code)
  if (!dup) {
    gndUsers.push({
      id: nextId(gndUsers),
      feishuOpenId: code,
      username: 'feishu_' + code.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40),
      password: '',
      name,
      roleType: null,
      supplierId: null,
      status: 'PENDING',
      createdAt: nowText()
    })
  }
  return { registered: true, status: 'PENDING', message: '注册申请已提交，等待管理员审批' }
}

// ===== 当前用户（PENDING 用户也可调用）=====
export function me(user) {
  return { id: user.id, username: user.username, feishuOpenId: user.feishuOpenId || '', name: user.name, email: user.email || '', roleType: user.roleType, supplierId: user.supplierId, status: user.status }
}

// ===== 修改密码（登录用户）=====
export function changePassword(user, body) {
  const oldPassword = String(body.oldPassword || '')
  const newPassword = String(body.newPassword || '')
  if (!user.password) throw new ApiError(422, 'VALIDATION_ERROR', '飞书账号无需密码，不支持此操作')
  if (user.password !== hashPassword(oldPassword)) throw new ApiError(401, 'INVALID_CREDENTIALS', '原密码错误')
  if (newPassword.length < 6) throw new ApiError(422, 'VALIDATION_ERROR', '新密码长度至少 6 位')
  user.password = hashPassword(newPassword)
  user.updatedAt = nowText()
  return { changed: true }
}
