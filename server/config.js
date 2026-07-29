const seconds = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const requiredEnv = (value, name) => {
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const config = {
  host: process.env.API_HOST || '127.0.0.1',
  port: Number(process.env.API_PORT || 3001),
  jwtSecret: requiredEnv(process.env.JWT_SECRET, 'JWT_SECRET') || 'dev-only-change-me',
  tokenTtlSeconds: seconds(process.env.TOKEN_TTL_SECONDS, 60 * 60 * 8),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 50 * 1024 * 1024)
}
