import { request } from './client.js'

export const fetchDim = () => request('/scenario-dimensions')
export const saveDim = (body) => request('/scenario-dimensions', { method: 'POST', body })
export const deleteDim = (id) => request(`/scenario-dimensions/${id}`, { method: 'DELETE' })
export const fetchTaggingQueue = (taskId) => request(`/tasks/${taskId}/tagging`)
export const saveItemTags = (itemId, tags) => request(`/items/${itemId}/tags`, { method: 'PUT', body: { tags } })
export const batchSaveTags = (itemIds, tags) => request('/items/batch-tags', { method: 'POST', body: { itemIds, tags } })
