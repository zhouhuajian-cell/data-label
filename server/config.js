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

const isProduction = () => process.env.NODE_ENV === 'production'

const requiredEnv = (value, name) => {
  if (!value && isProduction()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

// 生产环境必须用 MySQL：本地 db.json 是"整集合覆盖写"的单文件，没有并发与备份能力
const requireMysqlInProduction = (db) => {
  if (!isProduction()) return
  const missing = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter(k => !process.env[k])
  if (missing.length) {
    throw new Error(`生产环境必须配置 MySQL，缺少：${missing.join(', ')}`)
  }
}

const db = {
  host: process.env.DB_HOST || '',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || '',
  enabled: Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME)
}
requireMysqlInProduction(db)

// 生产环境弱配置告警（不阻断启动，但必须让运维看到）
if (isProduction()) {
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
    console.warn('[安全告警] CORS_ORIGIN 仍为 *，生产环境建议收敛到前端域名')
  }
  if (String(process.env.JWT_SECRET || '').length < 32) {
    console.warn('[安全告警] JWT_SECRET 长度不足 32 位，建议使用随机长密钥')
  }
}

export const config = {
  host: process.env.API_HOST || '0.0.0.0',
  port: Number(process.env.API_PORT || 3001),
  jwtSecret: requiredEnv(process.env.JWT_SECRET, 'JWT_SECRET') || 'dev-only-change-me',
  tokenTtlSeconds: seconds(process.env.TOKEN_TTL_SECONDS, 60 * 60 * 8),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // 限流：界面一次操作会连发多个请求，阈值按"人能点多快"设置；可用 RATE_LIMIT_ENABLED=0 关闭
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== '0',
    authPerMin: Number(process.env.RATE_LIMIT_AUTH_PER_MIN || 60),
    apiPerMin: Number(process.env.RATE_LIMIT_API_PER_MIN || 1200)
  },
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 50 * 1024 * 1024),
  // MySQL 持久化配置（DB_HOST 等留空则继续使用本地 db.json；生产环境强制要求）
  db
}
