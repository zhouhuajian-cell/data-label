import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 极简 .env 加载（项目根目录 .env，仅当环境变量未设置时读取）
try {
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
      }
    }
  }
} catch { /* .env 读取失败不影响启动 */ }

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
  host: process.env.API_HOST || '0.0.0.0',
  port: Number(process.env.API_PORT || 3001),
  jwtSecret: requiredEnv(process.env.JWT_SECRET, 'JWT_SECRET') || 'dev-only-change-me',
  tokenTtlSeconds: seconds(process.env.TOKEN_TTL_SECONDS, 60 * 60 * 8),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 50 * 1024 * 1024),
  // MySQL 持久化配置（DB_HOST 等留空则继续使用本地 db.json）
  db: {
    host: process.env.DB_HOST || '',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    enabled: Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME)
  }
}
