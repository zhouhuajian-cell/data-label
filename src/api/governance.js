import { request } from './client.js'

export const fetchGovernedDatasets = () => request('/governance/datasets')
export const fetchGovernedDetail = (id) => request(`/governance/datasets/${id}`)
export const importDataset = (body) => request('/governance/import', { method: 'POST', body })
export const importDatasetFile = (body) => request('/governance/import-file', { method: 'POST', body })
export const updateDatasetStatus = (id, status) => request(`/governance/datasets/${id}/status`, { method: 'PUT', body: { status } })
export const tagGovernedItem = (itemId, payload) => request(`/governance/items/${itemId}/tag`, { method: 'PUT', body: payload })
export const batchTagGovernedItems = (itemIds, tags) => request('/governance/items/batch-tag', { method: 'POST', body: { itemIds, tags } })
export const deleteDataset = (id) => request(`/governance/datasets/${id}`, { method: 'DELETE' })
export const deleteGovernedItem = (id) => request(`/governance/items/${id}`, { method: 'DELETE' })
export const previewSplitApi = (body) => request('/governance/preview-split', { method: 'POST', body })
