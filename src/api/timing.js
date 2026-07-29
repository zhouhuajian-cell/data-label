import { request } from './client.js'

export const heartbeat = (itemId, activeSeconds) => request('/timing/heartbeat', { method: 'POST', body: { itemId, activeSeconds } })
export const getMyTiming = () => request('/timing/my')
