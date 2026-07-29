import { request } from './client.js'

export const fetchNotifications = (params) => {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v) })
  return request('/notifications?' + q.toString())
}

export const markRead = (id) => request(`/notifications/${id}/read`, { method: 'PUT' })

export const markAllRead = () => request('/notifications/read-all', { method: 'PUT' })
