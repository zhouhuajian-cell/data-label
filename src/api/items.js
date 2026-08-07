import { request } from './client'

// ===== 任务明细（items）=====
export function getTaskItemsApi(taskId) {
  return request('/tasks/' + taskId + '/items')
}

export function updateTaskItemApi(taskId, itemId, payload) {
  return request('/tasks/' + taskId + '/items/' + itemId, { method: 'PUT', body: payload })
}

export function deleteTaskItemApi(taskId, itemId) {
  return request('/tasks/' + taskId + '/items/' + itemId, { method: 'DELETE' })
}

export function batchUpdateTaskItemsApi(taskId, payload) {
  return request('/tasks/' + taskId + '/items/batch', { method: 'PUT', body: payload })
}

export function importTaskItemsApi(taskId, payload) {
  return request('/tasks/' + taskId + '/items/import', { method: 'POST', body: payload })
}

export function importTaskItemsFileApi(taskId, payload) {
  return request('/tasks/' + taskId + '/items/import-file', { method: 'POST', body: payload })
}

export function uploadTaskPackageApi(taskId, payload) {
  return request('/tasks/' + taskId + '/package', { method: 'POST', body: payload })
}
