// 结算公式引擎测试：安全求值、变量白名单、公式结算与试算
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../server/config.js'
config.db.enabled = false // 不触碰真实 MySQL
import { compileFormula, validateFormula, DEFAULT_FORMULA, FORMULA_VARS } from '../server/lib/formula.js'
import { previewFormula } from '../server/services/bills.js'

const pm = { id: 1, roleType: 1, roleTypes: [1], userName: '管理员', supplierId: null }

test('公式求值：四则运算、括号、一元负号、百分比', () => {
  assert.equal(compileFormula('数量*单价').evaluate({ quantity: 10, unitPrice: 3.5 }), 35)
  assert.equal(compileFormula('(数量+2)*单价').evaluate({ quantity: 8, unitPrice: 10 }), 100)
  assert.equal(compileFormula('数量*单价-5').evaluate({ quantity: 10, unitPrice: 1 }), 5)
  assert.equal(compileFormula('数量*单价/2').evaluate({ quantity: 10, unitPrice: 2 }), 10)
  assert.equal(compileFormula('数量%3').evaluate({ quantity: 10 }), 1)
  assert.equal(compileFormula('-数量+10').evaluate({ quantity: 4 }), 6)
  assert.equal(compileFormula('金额').evaluate({ amount: 88.888 }), 88.888, '金额保留到 10 位小数，不再截成两位')
  // 10 位小数精度：0.1234567891 不被抹掉，且浮点尾差被收敛
  assert.equal(compileFormula('数量*单价').evaluate({ quantity: 3, unitPrice: 0.1234567891 }), 0.3703703673)
})

test('公式变量：系数支持单据级与行级，缺省为 1', () => {
  assert.equal(compileFormula('数量*单价*系数').evaluate({ quantity: 10, unitPrice: 3 }, { 系数: 0.9 }), 27)
  assert.equal(compileFormula('数量*单价*系数').evaluate({ quantity: 10, unitPrice: 3 }), 30, '未传系数按 1')
  assert.equal(compileFormula('数量*单价*系数').evaluate({ quantity: 10, unitPrice: 3, 系数: 2 }), 60, '行级系数优先')
})

test('公式安全：拒绝未知变量、非法字符、除零与负数结果', () => {
  assert.throws(() => compileFormula('process.exit(1)'), err => err.code === 'FORMULA_INVALID')
  assert.throws(() => compileFormula('数量;单价'), err => err.code === 'FORMULA_INVALID')
  assert.throws(() => compileFormula('数量+'), err => err.code === 'FORMULA_INVALID')
  assert.throws(() => compileFormula('(数量+单价'), err => err.code === 'FORMULA_INVALID')
  assert.throws(() => compileFormula('数量单价'), err => err.code === 'FORMULA_INVALID')
  assert.throws(() => compileFormula('数量-100').evaluate({ quantity: 10 }), err => err.code === 'FORMULA_INVALID')
  assert.equal(compileFormula('数量/0').evaluate({ quantity: 10 }), 0, '除零按 0 处理，不抛异常')
  assert.equal(validateFormula(''), DEFAULT_FORMULA, '空公式回落默认值')
  assert.equal(validateFormula('  数量 * 单价  '), '数量*单价')
})

test('试算接口：逐行金额与合计，且与正式结算同口径', () => {
  const items = [
    { taskName: 'A', quantity: 10, unitPrice: 3 },
    { taskName: 'B', quantity: 5, unitPrice: 3 }
  ]
  const r = previewFormula(pm, { formula: '数量*单价', items })
  assert.equal(r.rows.length, 2)
  assert.deepEqual(r.rows.map(x => x.amount), [30, 15])
  assert.equal(r.totalAmount, 45)
  assert.equal(r.formula, '数量*单价')
  assert.ok(r.variables, '返回可用变量说明')
  assert.equal(Object.keys(FORMULA_VARS).includes('系数'), true)

  const withCoef = previewFormula(pm, { formula: '数量*单价*系数', coefficient: 0.8, items })
  assert.equal(withCoef.totalAmount, 36)
  assert.throws(() => previewFormula(pm, { formula: '单价x', items }), err => err.code === 'FORMULA_INVALID')
  assert.throws(() => previewFormula(pm, { formula: '数量*单价', coefficient: -1, items }), err => err.status === 422)
})
