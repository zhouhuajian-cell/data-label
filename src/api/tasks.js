import { request } from './client'

export function getSupplierListApi() {
  return request('/suppliers')
}

export function getTaskListApi(params) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  })
  return request('/tasks?' + query.toString())
}

export function createTaskApi(payload) {
  return request('/tasks', {
    method: 'POST',
    body: payload
  })
}

export function dispatchTaskApi(id, payload) {
  return request('/tasks/' + id + '/dispatch', {
    method: 'POST',
    body: payload
  })
}

export function acceptTaskApi(id) {
  return request('/tasks/' + id + '/accept', { method: 'POST' })
}

export function completeWorkApi(id) {
  return request('/tasks/' + id + '/complete', { method: 'POST' })
}

export function getTaskDetailApi(id) {
  return request('/tasks/' + id)
}

export function submitTaskApi(id, payload) {
  return request('/tasks/' + id + '/submissions', {
    method: 'POST',
    body: payload
  })
}

export function reviewTaskApi(id, payload) {
  return request('/tasks/' + id + '/review', { method: 'POST', body: payload })
}

export function updateTaskApi(id, payload) {
  return request('/tasks/' + id, { method: 'PUT', body: payload })
}

export function deleteTaskApi(id) {
  return request('/tasks/' + id, { method: 'DELETE' })
}
