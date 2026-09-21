// 前端可见性判定：菜单/路由与后端同口径（曾因「纯供应商」判定用 every 语义，
// 导致叠加「独立结算」角色后误判为非纯供应商，从而看见「数据验收进度」）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ROLE_TYPE, isSupplierOnly, canAccessBills, isSettlementParty, defaultHomePath, FEATURES } from '../src/utils/constants.js'

const u = (roleTypes, userName = '某人') => ({ roleTypes, roleType: roleTypes[0], userName })

test('纯供应商判定：叠加标记角色后仍是纯供应商', () => {
  assert.equal(isSupplierOnly(u([3])), true, '仅供应商 → 纯供应商')
  assert.equal(isSupplierOnly(u([3, 19])), true, '供应商 + 独立结算 → 仍是纯供应商（关键回归点）')
  assert.equal(isSupplierOnly(u([3, 17])), false, '统结方带供应商角色 → 不是纯供应商')
  assert.equal(isSupplierOnly(u([3, 13])), false, '兼业务工程师 → 不是纯供应商')
  assert.equal(isSupplierOnly(u([1])), false, '管理员 → 不是供应商')
  assert.equal(isSupplierOnly(u([2])), false, '甲方质检员 → 不是供应商')
  assert.equal(isSupplierOnly({}), false, '无角色 → 否')
})

test('确认流可见性：独立结算身份不看确认流，其余角色不受影响', () => {
  assert.equal(canAccessBills(u([3, 19])), false, '独立结算 → 隐藏「数据验收进度」（本次需求）')
  assert.equal(canAccessBills(u([3])), false, '纯供应商 → 隐藏')
  assert.equal(canAccessBills(u([3, 17])), true, '统结方 → 可见（他要处理统结节点）')
  assert.equal(canAccessBills(u([1])), true, '管理员 → 可见')
  assert.equal(canAccessBills(u([13, 14])), true, '业务工程师 + 财务 → 可见')
  assert.equal(canAccessBills(u([18])), true, 'OA 结算专员 → 可见')
  assert.equal(canAccessBills(u([2])), false, '甲方质检员 → 不可见')
})

test('登录落点：独立结算供应商落在项目管理页', () => {
  if (FEATURES.DATA_MODULE) return   // 数据生产域打开时走另一套落点，本用例只覆盖结算模式
  assert.equal(defaultHomePath(u([3, 19])), '/supplier/projects')
  assert.equal(defaultHomePath(u([3])), '/supplier/projects')
  assert.notEqual(defaultHomePath(u([3, 19])), '/finance/bills', '不应落到确认流页面')
})

test('统结方身份判定不受影响', () => {
  assert.equal(isSettlementParty(u([3, 17])), true)
  assert.equal(isSettlementParty(u([3, 19])), false, '独立结算不是统结方')
})
