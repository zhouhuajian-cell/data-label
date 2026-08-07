import { request } from './client'

// ===== 飞书 Webhook 通知 =====
export function getFeishuWebhookApi() {
  return request('/feishu/webhook')
}

export function setFeishuWebhookApi(payload) {
  return request('/feishu/webhook', { method: 'POST', body: payload })
}

export function pushFeishuApi(payload) {
  return request('/feishu/push', { method: 'POST', body: payload })
}

export function pushProjectSummaryApi(projectId) {
  return request('/feishu/project-summary/' + projectId, { method: 'POST' })
}
