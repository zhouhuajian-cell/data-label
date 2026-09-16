// 认证路由（无需鉴权）：健康检查、账号/飞书登录
// 注：账号列表不再对外暴露（原先的 /api/auth/demo-accounts 已下线），账号由甲方PM在「用户管理」内维护。
import { config } from '../config.js'
import { ok, readJson } from '../lib/http.js'
import { issueToken, requireAuth } from '../lib/auth.js'
import { loginByPassword, loginByFeishuCode, changeOwnPassword } from '../services/auth.js'
import { createFeishuQrSession, pollFeishuSession, scanFeishuQr } from '../services/feishu.js'
import { tokenRoles } from '../lib/roles.js'

function toLoginPayload(user) {
  const { token, expiresIn } = issueToken(user)
  const { roleType, roleTypes } = tokenRoles(user)
  return {
    token,
    expiresIn,
    userInfo: {
      userName: user.userName,
      roleType,
      roleTypes,
      mustChangePassword: !!user.mustChangePassword
    }
  }
}

export async function authRouter({ req, res, url, pathname }) {
  const body = () => readJson(req, config.maxBodyBytes)
  const is = (method, p) => req.method === method && pathname === p

  if (is('GET', '/api/health')) { ok(res, { status: 'up', service: 'data-label-api', time: new Date().toISOString() }); return true }
  if (is('POST', '/api/auth/login')) { ok(res, toLoginPayload(loginByPassword(await body()))); return true }
  if (is('POST', '/api/auth/feishu')) { ok(res, toLoginPayload(loginByFeishuCode(await body()))); return true }
  if (is('POST', '/api/auth/feishu/qr')) { ok(res, createFeishuQrSession()); return true }
  if (is('GET', '/api/auth/feishu/qr')) { ok(res, pollFeishuSession(url.searchParams.get('key'))); return true }
  if (is('POST', '/api/auth/feishu/scan')) { ok(res, scanFeishuQr(await body())); return true }

  // ===== 已登录账号自助改密 =====
  if (is('PUT', '/api/auth/password')) {
    const user = requireAuth(req)
    ok(res, changeOwnPassword(user, await body()))
    return true
  }
  if (is('GET', '/api/auth/me')) {
    const user = requireAuth(req)
    const { roleType, roleTypes } = tokenRoles(user)
    ok(res, {
      id: user.id, username: user.username, userName: user.userName,
      roleType, roleTypes,
      mustChangePassword: !!user.mustChangePassword
    })
    return true
  }
  return false
}
