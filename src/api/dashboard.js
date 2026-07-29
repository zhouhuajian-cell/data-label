import { request } from './client'

export function getDashboardStatsApi() {
  return request('/projects/count')
}

export function updateProjectCountApi(payload) {
  return request('/projects/count', {
    method: 'POST',
    body: payload
  })
}
