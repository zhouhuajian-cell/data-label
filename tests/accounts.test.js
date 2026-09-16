// 账号体系测试：多角色（环环相扣）、鉴权、改密
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../server/config.js'
import { users } from '../server/repositories/data.js'
import { normalizeRoleTypes, roleTypesOf, hasRole, hasAnyRole, tokenRoles } from '../server/lib/roles.js'
import { createUser, updateUser, adminResetPassword, listUsers, deleteUser } from '../server/services/users.js'
import { changeOwnPassword, loginByPassword, PASSWORD_MIN_LENGTH } from '../server/services/auth.js'
// 单元测试绝不触碰真实 MySQL（本用例只操作内存集合）
config.db.enabled = false

const pm = { id: 1, username: 'taixing', roleType: 1, roleTypes: [1], userName: '甲方PM', supplierId: null }

test('角色工具：主角色恒在首位，兼容单角色与多角色', () => {
  assert.deepEqual(roleTypesOf({ roleType: 13 }), [13])
  assert.deepEqual(roleTypesOf({ roleType: 13, roleTypes: [14, 15] }), [13, 14, 15])
  assert.deepEqual(roleTypesOf({ roleType: 14, roleTypes: [14, 13] }), [14, 13])
  assert.deepEqual(roleTypesOf({ roleType: 3, roleTypes: [] }), [3])
  assert.deepEqual(roleTypesOf(null), [])
  assert.equal(hasRole({ roleType: 13, roleTypes: [13, 14] }, 14), true)
  assert.equal(hasAnyRole({ roleType: 13, roleTypes: [13, 14] }, [15, 16]), false)
})

test('角色校验：非法角色被拒绝，空角色被拒绝', () => {
  assert.throws(() => normalizeRoleTypes([99], 1), err => err.code === 'VALIDATION_ERROR')
  assert.throws(() => normalizeRoleTypes([], null), err => err.code === 'VALIDATION_ERROR')
  assert.deepEqual(normalizeRoleTypes([15, 13, 13], null), [13, 15])
})

test('创建账号：多角色 + 首登强制改密；供应商角色不再需要归属供应商', () => {
  const created = createUser(pm, {
    username: 'multi_role_01', userName: '多角色账员', roleTypes: [13, 14], password: 'abc123'
  })
  assert.deepEqual(created.roleTypes, [13, 14])
  assert.equal(created.roleType, 13)
  assert.equal(created.mustChangePassword, true)
  assert.equal(created.password, undefined, '不应返回密码字段')

  // 归属供应商逻辑已删除：供应商身份以「姓名」为准，建号不再要求绑定供应商
  const sup = createUser(pm, { username: 'sup_x', userName: '供应商X', roleTypes: [3] })
  assert.deepEqual(sup.roleTypes, [3])
  assert.equal(sup.supplierId, undefined, '不再返回/保存归属供应商')
  assert.throws(() => createUser(pm, { username: 'multi_role_01', userName: '重复' }),
    err => err.code === 'STATE_CONFLICT')
  assert.throws(() => createUser({ ...pm, roleType: 13, roleTypes: [13] }, { username: 'x', userName: 'x' }),
    err => err.code === 'FORBIDDEN')
})

test('编辑账号：可增删角色，主角色随之更新', () => {
  const created = createUser(pm, { username: 'multi_role_02', userName: '账员2', roleTypes: [15] })
  const updated = updateUser(pm, created.id, { roleTypes: [16, 15] })
  assert.deepEqual(updated.roleTypes, [15, 16])
  assert.equal(updated.roleType, 15)
  // 切换为供应商角色同样不再要求归属供应商
  assert.deepEqual(updateUser(pm, created.id, { roleTypes: [3] }).roleTypes, [3])
})

test('改密：原密码校验、长度校验、新旧不同；成功后清除强制改密标记', () => {
  const created = createUser(pm, { username: 'pwd_user_01', userName: '改密账员', roleTypes: [13], password: 'old123' })
  const u = users.find(x => x.id === created.id)
  assert.equal(u.mustChangePassword, true)

  assert.throws(() => changeOwnPassword(u, { oldPassword: 'wrong', newPassword: 'new123' }),
    err => err.code === 'INVALID_CREDENTIALS')
  assert.throws(() => changeOwnPassword(u, { oldPassword: 'old123', newPassword: '123' }),
    err => err.status === 422)
  assert.throws(() => changeOwnPassword(u, { oldPassword: 'old123', newPassword: 'old123' }),
    err => err.status === 422)
  assert.throws(() => changeOwnPassword(u, { oldPassword: '', newPassword: 'new123' }),
    err => err.status === 422)

  const res = changeOwnPassword(u, { oldPassword: 'old123', newPassword: 'new1234' })
  assert.equal(res.changed, true)
  assert.equal(u.mustChangePassword, false)
  // 新密码可登录，旧密码失效
  assert.ok(loginByPassword({ username: 'pwd_user_01', password: 'new1234' }))
  assert.throws(() => loginByPassword({ username: 'pwd_user_01', password: 'old123' }),
    err => err.code === 'INVALID_CREDENTIALS')
})

test('管理员重置密码：置为待改密，且仅甲方PM可操作', () => {
  const created = createUser(pm, { username: 'pwd_user_02', userName: '重置账员', roleTypes: [14], password: 'init123' })
  assert.throws(() => adminResetPassword({ ...pm, roleType: 13, roleTypes: [13] }, created.id, 'reset123'),
    err => err.code === 'FORBIDDEN')
  const res = adminResetPassword(pm, created.id, 'reset1234')
  assert.equal(res.mustChangePassword, true)
  const u = users.find(x => x.id === created.id)
  assert.equal(u.mustChangePassword, true)
  assert.ok(loginByPassword({ username: 'pwd_user_02', password: 'reset1234' }))
})

test('鉴权：token 携带全部角色；禁用账号不可登录；不能禁用自身', () => {
  const created = createUser(pm, { username: 'token_user_01', userName: '令牌账员', roleTypes: [13, 16] })
  const u = users.find(x => x.id === created.id)
  assert.deepEqual(tokenRoles(u), { roleType: 13, roleTypes: [13, 16] })

  assert.throws(() => deleteUser(pm, 1), err => err.status === 422)
  deleteUser(pm, created.id)
  assert.throws(() => loginByPassword({ username: 'token_user_01', password: '123456' }),
    err => err.code === 'INVALID_CREDENTIALS')
})

test('用户列表：返回多角色且不返回密码', () => {
  const list = listUsers(pm)
  const row = list.find(x => x.username === 'multi_role_01')
  assert.ok(row)
  assert.deepEqual(row.roleTypes, [13, 14])
  assert.equal(row.password, undefined)
  assert.ok(PASSWORD_MIN_LENGTH >= 6)
})
