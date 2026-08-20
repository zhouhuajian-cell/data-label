// GND 业务模块 API（token 统一存 'token'，与旧业务域共用登录态）
import { request } from './client'

// ===== 认证 =====
export function gndLoginApi(payload) {
  return request('/gnd/auth/login', { method: 'POST', body: payload })
}
export function gndFeishuApi(payload) {
  return request('/gnd/auth/feishu', { method: 'POST', body: payload })
}
export function gndMeApi() {
  return request('/gnd/auth/me')
}
export function gndChangePasswordApi(payload) {
  return request('/gnd/auth/password', { method: 'PUT', body: payload })
}

// ===== 用户与供应商 =====
export function gndUsersApi(params) {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v) })
  return request('/gnd/users?' + q.toString())
}
export function gndApproveUserApi(id, payload) {
  return request('/gnd/users/' + id + '/approve', { method: 'PUT', body: payload })
}
export function gndRejectUserApi(id) {
  return request('/gnd/users/' + id + '/reject', { method: 'PUT' })
}
export function gndDisableUserApi(id, payload) {
  return request('/gnd/users/' + id + '/disable', { method: 'PUT', body: payload })
}
export function gndSuppliersApi(params) {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v) })
  return request('/gnd/suppliers?' + q.toString())
}
export function gndCreateSupplierApi(payload) {
  return request('/gnd/suppliers', { method: 'POST', body: payload })
}

// ===== 测区任务 =====
export function gndTasksApi(params) {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v) })
  return request('/gnd/tasks?' + q.toString())
}
export function gndCreateTaskApi(payload) {
  return request('/gnd/tasks', { method: 'POST', body: payload })
}
export function gndTaskDetailApi(id) {
  return request('/gnd/tasks/' + id)
}
export function gndUpdateTaskApi(id, payload) {
  return request('/gnd/tasks/' + id, { method: 'PUT', body: payload })
}

// ===== 状态流转 =====
export const gndAction = (id, action, payload) => request('/gnd/tasks/' + id + '/' + action, { method: 'POST', body: payload || {} })
export const gndReceiveApi = (id) => gndAction(id, 'receive')
export const gndSubmitApi = (id, payload) => gndAction(id, 'submit', payload)
export const gndSubmitCancelApi = (id) => gndAction(id, 'submit/cancel')
export const gndVoidApi = (id, payload) => gndAction(id, 'void', payload)
export const gndOptStartApi = (id, payload) => gndAction(id, 'optimization/start', payload)
export const gndOptSkipApi = (id, payload) => gndAction(id, 'optimization/skip', payload)
export const gndOptCompleteApi = (id, payload) => gndAction(id, 'optimization/complete', payload)
export const gndAcceptanceApi = (id, payload) => gndAction(id, 'acceptance', payload)
export const gndAcceptanceRevertApi = (id, payload) => gndAction(id, 'acceptance/revert', payload)
export const gndWarehouseApi = (id, payload) => gndAction(id, 'warehouse', payload)
export const gndWarehouseRecoverApi = (id, payload) => gndAction(id, 'warehouse/recover', payload)
export const gndPerceptionApi = (id, payload) => request('/gnd/tasks/' + id + '/perception', { method: 'PUT', body: payload })
export const gndRepairApi = (id, payload) => gndAction(id, 'repair', payload)
export const gndRepairCancelApi = (id) => gndAction(id, 'repair/cancel')

// ===== 配置与统计 =====
export function gndOptionsApi(category) {
  return request('/gnd/options' + (category ? '?category=' + category : ''))
}
export function gndSetOptionsApi(category, items) {
  return request('/gnd/options/' + category, { method: 'PUT', body: { items } })
}
export function gndStatsApi(params) {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v) })
  return request('/gnd/stats/overview?' + q.toString())
}
export function gndExportApi(params) {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v) })
  return request('/gnd/stats/export?' + q.toString(), { headers: { Accept: 'text/csv' } })
}
