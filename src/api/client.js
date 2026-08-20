import { ElMessage } from 'element-plus'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const rawApiBase = import.meta.env.VITE_API_BASE
const devTarget = import.meta.env.VITE_API_TARGET || 'http://127.0.0.1:3001'
const API_BASE = import.meta.env.DEV
  ? devTarget.replace(/\/+$/, '') + '/api'
  : rawApiBase && rawApiBase.trim()
    ? rawApiBase.trim().replace(/\/+$/, '')
    : '/api'

function normalizePath(path) {
  let normalized = String(path || '')
  if (!normalized.startsWith('/')) normalized = '/' + normalized
  normalized = normalized.replace(/\/+/g, '/')
  return normalized
}

function getToken(key) {
  return localStorage.getItem(key || 'token') || ''
}

export async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }
  const token = getToken(options.tokenKey)
  if (token) headers.authorization = 'Bearer ' + token

  let response
  try {
    response = await fetch(API_BASE + normalizePath(path), {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
  } catch (error) {
    ElMessage.error('网络异常，请稍后重试')
    throw error
  }

  const text = await response.text()
  let payload = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }

  if (!response.ok || payload.code !== 0) {
    const message = payload.message || `请求失败 (${response.status})`
    const error = new ApiError(response.status, payload.code || 'HTTP_ERROR', message, payload.details)
    if (response.status === 401) {
      ElMessage.error('登录态已失效，请重新登录')
    } else {
      ElMessage.error(message)
    }
    throw error
  }

  return payload
}
