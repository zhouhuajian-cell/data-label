// 密码哈希（Node 内置 scrypt，不引入额外依赖，Docker 无需编译原生模块）
// 存储格式：scrypt$<N>$<salt-hex>$<hash-hex>
import crypto from 'node:crypto'

const PREFIX = 'scrypt'
const KEYLEN = 64
// 成本参数：N 越大越慢越安全。16384 为 Node 默认，单次约 50~100ms
const COST = 16384
const BLOCK_SIZE = 8
const PARALLELISM = 1
const SALT_BYTES = 16

export function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_BYTES)
  const hash = crypto.scryptSync(String(plain), salt, KEYLEN, { N: COST, r: BLOCK_SIZE, p: PARALLELISM })
  return [PREFIX, COST, salt.toString('hex'), hash.toString('hex')].join('$')
}

// 是否已是哈希（用于识别历史遗留的明文密码）
export function isHashed(value) {
  return typeof value === 'string' && value.startsWith(PREFIX + '$')
}

export function verifyPassword(plain, stored) {
  if (!isHashed(stored)) return false
  const parts = stored.split('$')
  if (parts.length !== 4) return false
  const cost = Number(parts[1])
  let salt
  let expected
  try {
    salt = Buffer.from(parts[2], 'hex')
    expected = Buffer.from(parts[3], 'hex')
  } catch {
    return false
  }
  if (!Number.isFinite(cost) || !salt.length || !expected.length) return false
  let actual
  try {
    actual = crypto.scryptSync(String(plain), salt, expected.length, { N: cost, r: BLOCK_SIZE, p: PARALLELISM })
  } catch {
    return false
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}
