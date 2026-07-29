import { ApiError } from '../lib/http.js'
import { users } from '../repositories/data.js'

const feishuMap = {
  'feishu-admin': 'admin',
  'feishu-qa': 'qa_01',
  'feishu-suppa': 'supp_a',
  'feishu-suppb': 'supp_b'
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
  return user
}
