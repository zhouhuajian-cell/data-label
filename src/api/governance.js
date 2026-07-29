import { request } from './client.js'

export const fetchGovernedDatasets = () => request('/governance/datasets')
export const fetchGovernedDetail = (id) => request(`/governance/datasets/${id}`)
export const importDataset = (body) => request('/governance/import', { method: 'POST', body })
export const updateDatasetStatus = (id, status) => request(`/governance/datasets/${id}/status`, { method: 'PUT', body: { status } })
export const tagGovernedItem = (itemId, tags) => request(`/governance/items/${itemId}/tag`, { method: 'PUT', body: { tags } })
export const batchTagGovernedItems = (itemIds, tags) => request('/governance/items/batch-tag', { method: 'POST', body: { itemIds, tags } })
