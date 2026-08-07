import { request } from './client'

export function getProjectsApi() {
  return request('/projects')
}

export function createProjectApi(payload) {
  return request('/projects', { method: 'POST', body: payload })
}

export function updateProjectStatusApi(id, payload) {
  return request('/projects/' + id + '/status', { method: 'PUT', body: payload })
}

export function updateProjectApi(id, payload) {
  return request('/projects/' + id, { method: 'PUT', body: payload })
}

export function deleteProjectApi(id) {
  return request('/projects/' + id, { method: 'DELETE' })
}

export function importProjectsApi(rows) {
  return request('/projects/import', { method: 'POST', body: { rows } })
}

export function getProjectDetailApi(id) {
  return request('/projects/' + id)
}

export function importProjectTasksApi(projectId, rows) {
  return request('/projects/' + projectId + '/tasks/import', { method: 'POST', body: { rows } })
}

export function splitProjectApi(projectId, payload) {
  return request('/projects/' + projectId + '/split', { method: 'POST', body: payload })
}

export function importProjectTasksFileApi(projectId, payload) {
  return request('/projects/' + projectId + '/tasks/import-file', { method: 'POST', body: payload })
}

export function archiveProjectApi(projectId) {
  return request('/projects/archive', { method: 'POST', body: { projectId } })
}

export function parseProjectExcelApi(payload) {
  return request('/projects/parse-excel', { method: 'POST', body: payload })
}
