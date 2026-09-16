// 启动期数据迁移（幂等）
// 目前只有一项：把历史遗留的明文密码改成 scrypt 哈希，并删除明文字段。
import { users, auditLogs } from '../repositories/data.js'
import { nowText } from '../lib/time.js'
import { hashPassword, isHashed } from '../lib/password.js'

// 明文 → 哈希。返回迁移的人数（0 表示无需迁移）。
export function migratePlaintextPasswords() {
  let migrated = 0
  for (const u of users) {
    // 已有哈希则跳过；仅处理还带明文 password 的账号
    if (u.passwordHash && isHashed(u.passwordHash)) {
      if (u.password !== undefined) delete u.password
      continue
    }
    if (typeof u.password === 'string' && u.password) {
      u.passwordHash = hashPassword(u.password)
      delete u.password
      migrated++
    }
  }
  if (migrated > 0) {
    auditLogs.push({ action: 'migration.passwordHash', actorId: null, count: migrated, at: nowText() })
    console.log(`已将 ${migrated} 个账号的明文密码迁移为 scrypt 哈希`)
  }
  return migrated
}
