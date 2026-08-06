import { request } from './client.js'

export const getWorkbenchQueue = (taskId) => request(`/tasks/${taskId}/workbench`)
export const claimItem = (itemId) => request(`/items/${itemId}/claim`, { method: 'POST' })
export const claimQaTask = (taskId) => request(`/tasks/${taskId}/qa-claim`, { method: 'POST' })
export const releaseQaTask = (taskId) => request(`/tasks/${taskId}/qa-release`, { method: 'POST' })
export const saveAnnotation = (itemId, boxes) => request(`/items/${itemId}/annotation`, { method: 'PUT', body: { boxes } })
export const submitItem = (itemId) => request(`/items/${itemId}/submit`, { method: 'POST' })
export const vendorQaItem = (itemId, body) => request(`/items/${itemId}/vendor-qa`, { method: 'POST', body })
export const clientQaItem = (itemId, body) => request(`/items/${itemId}/client-qa`, { method: 'POST', body })
export const batchVendorQa = (body) => request('/items/batch-vendor-qa', { method: 'POST', body })
export const batchClientQa = (body) => request('/items/batch-client-qa', { method: 'POST', body })
