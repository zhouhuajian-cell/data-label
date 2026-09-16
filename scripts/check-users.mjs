// 只读检查：列出剩余账号 + 确认确认链所需角色是否齐全
// 用法（服务器上）：mysql -uroot -N -e "SELECT data FROM data_label.app_state WHERE name='users'" > /tmp/u.json
//   /opt/data_label/runtime/node/bin/node /tmp/check-users.mjs
import fs from 'node:fs'

const users = JSON.parse(fs.readFileSync('/tmp/u.json', 'utf8'))
const rolesOf = (u) => (Array.isArray(u.roleTypes) && u.roleTypes.length ? u.roleTypes : [u.roleType]).filter(x => x !== undefined)

console.log(`账号数：${users.length}`)
console.log('用户名           姓名         角色        状态')
for (const u of users) {
  console.log(
    String(u.username).padEnd(16) +
    String(u.userName || '').padEnd(13) +
    JSON.stringify(rolesOf(u)).padEnd(12) +
    (u.disabled ? '已禁用' : '正常') +
    (u.mustChangePassword ? ' · 待改密' : '')
  )
}

// 确认链必需角色（与 server/lib/bill-flow.js 一致）
const CHAIN = [
  [1, '甲方PM（发起/指派/看全量）'],
  [3, '供应商'],
  [13, '业务工程师'],
  [14, '财务'],
  [17, '统结方'],
  [15, '负责人'],
  [16, '算法'],
  [18, 'OA结算专员']
]
console.log('\n确认链角色覆盖检查：')
let missing = 0
for (const [role, label] of CHAIN) {
  const hit = users.filter(u => !u.disabled && rolesOf(u).includes(role)).map(u => u.userName)
  if (!hit.length) { missing++; console.log(`  ✗ 缺少 ${label}（role ${role}）`) }
  else console.log(`  ✓ ${label}：${hit.join('、')}`)
}
console.log(missing ? `\n⚠ 有 ${missing} 个必需角色没有可用账号，流程会卡在对应环节` : '\n✓ 确认链角色齐全')
