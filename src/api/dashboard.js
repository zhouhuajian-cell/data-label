import { request } from './client'

export function getDashboardDataApi() {
  return request('/dashboard')
}
