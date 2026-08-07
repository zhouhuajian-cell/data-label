import { request } from './client'

// ===== 用户管理 =====
export function listUsersApi() {
  return request('/users')
}

export function createUserApi(payload) {
  return request('/users', { method: 'POST', body: payload })
}

export function updateUserApi(id, payload) {
  return request('/users/' + id, { method: 'PUT', body: payload })
}

export function deleteUserApi(id) {
  return request('/users/' + id, { method: 'DELETE' })
}

// ===== 系统日志 =====
export function getLogsApi(params) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, v)
  })
  const qs = query.toString()
  return request('/admin/logs' + (qs ? '?' + qs : ''))
}
