import { request } from './client.js'

export const listSettlements = () => request('/settlements')
export const generateSettlement = (taskId) => request('/settlements/generate', { method: 'POST', body: { taskId } })
export const confirmSettlement = (id) => request(`/settlements/${id}/confirm`, { method: 'POST' })
export const exportSettlementUrl = (id) => id
