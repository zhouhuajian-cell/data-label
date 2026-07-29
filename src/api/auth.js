import { request } from './client'

export function loginApi(params) {
  return request('/auth/login', {
    method: 'POST',
    body: params
  })
}

export function feishuLoginApi(params) {
  return request('/auth/feishu', {
    method: 'POST',
    body: params
  })
}

export function createFeishuQrSessionApi() {
  return request('/auth/feishu/qr', {
    method: 'POST'
  })
}

export function pollFeishuQrSessionApi(key) {
  const query = new URLSearchParams({ key })
  return request(`/auth/feishu/qr?${query.toString()}`)
}

export function scanFeishuQrApi(payload) {
  return request('/auth/feishu/scan', {
    method: 'POST',
    body: payload
  })
}

export function getMeApi() {
  return request('/users/me')
}
