// HTTP 中间件：CORS、安全响应头、限流
import { ApiError } from './lib/http.js'
import { authLimiter, apiLimiter } from './lib/rate-limiter.js'
import { config } from './config.js'

export function setCors(req, res) {
  const origin = req.headers.origin
  const allowed = config.corsOrigin === '*' || (origin && origin === config.corsOrigin)
  res.setHeader('access-control-allow-origin', allowed ? origin || String(config.corsOrigin) : String(config.corsOrigin))
  res.setHeader('vary', 'Origin')
  res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, Accept')
  res.setHeader('access-control-expose-headers', 'Authorization')
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('access-control-allow-credentials', 'true')
  res.setHeader('access-control-max-age', '86400')
}

export function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('x-xss-protection', '1; mode=block')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('x-permitted-cross-domain-policies', 'none')
  res.setHeader('x-download-options', 'noopen')
}

export function getClientKey(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
}

// 生产环境限流：auth 路由 10 次/分，其余 API 100 次/分（/api/health 豁免）
export function applyRateLimit(req, res, normalizedPath) {
  if (process.env.NODE_ENV !== 'production') return
  const clientKey = 'api:' + getClientKey(req)
  const isAuthRoute = normalizedPath.startsWith('/api/auth')
  const limiter = isAuthRoute ? authLimiter : (normalizedPath.startsWith('/api') && normalizedPath !== '/api/health' ? apiLimiter : null)
  if (!limiter) return
  const result = limiter(clientKey)
  if (!result.allowed) {
    res.setHeader('retry-after', String(result.retryAfter))
    throw new ApiError(429, 'RATE_LIMITED', `请求过于频繁，请 ${result.retryAfter} 秒后重试`)
  }
}
