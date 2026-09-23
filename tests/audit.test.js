// 操作审计：敏感操作必须留痕，且能具体到人（操作人 / 时间 / 对象 / 做了什么）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../server/config.js'
config.db.enabled = false // 不触碰真实 MySQL
import { users, auditLogs } from '../server/repositories/data.js'
import { createUser, updateUser, deleteUser, adminResetPassword } from '../server/services/users.js'
import { loginByPassword } from '../server/services/auth.js'
import { hashPassword } from '../server/lib/password.js'

const admin = { id: 900, username: 'admin_t', userName: '测试管理员', roleType: 1, roleTypes: [1], disabled: false }
const lastLog = (action) => [...auditLogs].reverse().find(l => l.action === action)

test('审计：新增账号记录操作人、对象与角色', () => {
  const before = auditLogs.length
  createUser(admin, { username: 'audit_u1', userName: '审计测试员', roleTypes: [3], password: 'Abc123456' })
  const log = lastLog('user.create')
  assert.ok(log, '应写入 user.create')
  assert.equal(log.actorName, '测试管理员', '记录操作人姓名')
  assert.equal(log.targetName, '审计测试员', '记录被建账号')
  assert.deepEqual(log.roleTypes, [3])
  assert.ok(log.at, '记录时间')
  assert.ok(auditLogs.length > before)
})

test('审计：改角色要能看出改了哪个字段、前后是什么', () => {
  const u = users.find(x => x.username === 'audit_u1')
  updateUser(admin, u.id, { roleTypes: [3, 19] })
  const log = lastLog('user.update')
  assert.ok(log)
  assert.equal(log.actorName, '测试管理员')
  assert.equal(log.targetName, '审计测试员')
  assert.deepEqual(log.changed, ['roleTypes'], '只记录真正变化的字段')
  assert.deepEqual(log.before.roleTypes, [3])
  assert.deepEqual(log.after.roleTypes, [3, 19])
})

test('审计：提交内容没变化时不写日志（避免刷屏）', () => {
  const u = users.find(x => x.username === 'audit_u1')
  const n = auditLogs.filter(l => l.action === 'user.update').length
  updateUser(admin, u.id, { userName: u.userName })
  assert.equal(auditLogs.filter(l => l.action === 'user.update').length, n)
})

test('审计：重置密码与停用账号都留痕', () => {
  const u = users.find(x => x.username === 'audit_u1')
  adminResetPassword(admin, u.id, 'Abc654321')
  const rp = lastLog('user.resetPassword')
  assert.equal(rp.actorName, '测试管理员')
  assert.equal(rp.targetName, '审计测试员')

  deleteUser(admin, u.id)
  const dis = lastLog('user.disable')
  assert.equal(dis.targetName, '审计测试员')
  assert.equal(u.disabled, true)
})

test('审计：登录成功与失败都留痕（失败只记账号不记密码）', () => {
  const u = users.find(x => x.username === 'audit_u1')
  u.disabled = false
  u.passwordHash = hashPassword('Abc123456')

  loginByPassword({ username: 'audit_u1', password: 'Abc123456' })
  const ok = lastLog('auth.login')
  assert.equal(ok.actorName, '审计测试员', '登录也具体到人')
  assert.equal(ok.username, 'audit_u1')

  assert.throws(() => loginByPassword({ username: 'audit_u1', password: 'wrong' }))
  const bad = lastLog('auth.loginFail')
  assert.equal(bad.username, 'audit_u1')
  assert.equal(JSON.stringify(bad).includes('wrong'), false, '绝不能把密码写进日志')
})
