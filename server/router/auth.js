// 认证路由（无需鉴权）：健康检查、账号/飞书登录
import { config } from '../config.js'
import { ok, readJson } from '../lib/http.js'
import { issueToken } from '../lib/auth.js'
import { loginByPassword, loginByFeishuCode } from '../services/auth.js'
import { createFeishuQrSession, pollFeishuSession, scanFeishuQr } from '../services/feishu.js'

function toLoginPayload(user) {
  const { token, expiresIn } = issueToken(user)
  return {
    token,
    expiresIn,
    userInfo: { userName: user.userName, roleType: user.roleType, supplierId: user.supplierId }
  }
}

export async function authRouter({ req, res, url, pathname }) {
  const body = () => readJson(req, config.maxBodyBytes)
  const is = (method, p) => req.method === method && pathname === p

  if (is('GET', '/api/health')) { ok(res, { status: 'up', service: 'zhiyun-label-api', time: new Date().toISOString() }); return true }
  if (is('POST', '/api/auth/login')) { ok(res, toLoginPayload(loginByPassword(await body()))); return true }
  if (is('POST', '/api/auth/feishu')) { ok(res, toLoginPayload(loginByFeishuCode(await body()))); return true }
  if (is('POST', '/api/auth/feishu/qr')) { ok(res, createFeishuQrSession()); return true }
  if (is('GET', '/api/auth/feishu/qr')) { ok(res, pollFeishuSession(url.searchParams.get('key'))); return true }
  if (is('POST', '/api/auth/feishu/scan')) { ok(res, scanFeishuQr(await body())); return true }
  return false
}
