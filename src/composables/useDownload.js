// 带鉴权的文件下载工具：拼接 API 地址 + token，以 Blob 方式保存文件
const API_BASE = import.meta.env.DEV
  ? (import.meta.env.VITE_API_TARGET || 'http://127.0.0.1:3001').replace(/\/+$/, '') + '/api'
  : (import.meta.env.VITE_API_BASE || '').trim()
    ? import.meta.env.VITE_API_BASE.trim().replace(/\/+$/, '')
    : '/api'

export function useDownload() {
  async function downloadFile(urlPath, fallbackName = 'download') {
    const token = localStorage.getItem('token') || ''
    const res = await fetch(API_BASE + urlPath, { headers: { Authorization: 'Bearer ' + token } })
    if (!res.ok) {
      let message = '下载失败'
      try { const j = await res.json(); message = j.message || message } catch { /* 非 JSON 响应 */ }
      throw new Error(message)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fallbackName
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return { downloadFile }
}
