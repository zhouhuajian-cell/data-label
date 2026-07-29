import { request } from './client.js'

export const fetchDatasets = () => request('/datasets')
export const fetchDatasetItems = (taskId) => request(`/datasets/${taskId}/items`)
