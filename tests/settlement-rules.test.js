// 结算业务规则测试：成本中心比例合计 100%、结算增幅超 3.5% 拦截并报警
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../server/config.js'
config.db.enabled = false // 不触碰真实 MySQL
import { feishuConfig, projects, notifications, users } from '../server/repositories/data.js'
import { hasRole } from '../server/lib/roles.js'
import {
  createBill, confirmBill, calculateBill, getBillDetail, listBills, increaseCheck, MAX_INCREASE_RATE, assignEngineer,
  settlementSummary, settlementSubmittedOf
} from '../server/services/bills.js'

feishuConfig.enabled = false
projects.push({ id: 902, name: '规则测试项目', clientName: '', status: 'active' })
// OA 结算专员账号（末环节，彭桂苹）
const OA_ID = 903
users.push({ id: OA_ID, username: 'oa_t', userName: '彭桂苹', roleType: 18, roleTypes: [18], disabled: false })
const PROJECT_ID = 902

// 供应商身份以「姓名」为准：用种子里真实的供应商账号
const seedSupplier = users.find(u => !u.disabled && hasRole(u, 3))
assert.ok(seedSupplier, '种子账号里应有供应商角色账号')
const supplierA = { id: seedSupplier.id, roleType: 3, roleTypes: [3], userName: seedSupplier.userName }
const ENGINEER_ID = 21
const bizEngineer = { id: ENGINEER_ID, roleType: 13, roleTypes: [13], supplierId: null, userName: '业务工程师' }
const finance = { id: 304, roleType: 14, supplierId: null, userName: '财务专员' }
const leader = { id: 305, roleType: 15, supplierId: null, userName: '负责人' }
const party = { id: 308, roleType: 17, roleTypes: [17], supplierId: null, userName: '柏川' }
const pm = { id: 307, roleType: 1, supplierId: null, userName: '管理员' }

// 统结方确认助手：按当前"供应商确认合计"等额提交（增幅 0%，必然在 3.5% 红线内）
// 统结方导入提交 → 财务二次确认（链上现在是两步）
async function confirmParty(bill, comment) {
  const d = await getBillDetail(pm, bill.id)
  const base = d.supplierConfirmedTotal?.supplierTotal || 1
  await confirmBill(party, bill.id, {
    items: [{ taskName: '统结明细', quantity: 1, unitPrice: base }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: '统结附件.csv', size: 1 }],
    comment
  })
  return confirmBill(finance, bill.id, {})
}

let seq = 0
const makeBill = async (items, extra = {}) => {
  const bill = await createBill(supplierA, {
  projectId: PROJECT_ID,
  batchName: '规则批次-' + (++seq),
  period: '2033-01',
  importMode: 'paste',
  attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
  costCenters: [{ name: 'M57', ratio: 100 }],
  items: items || [{ taskName: 'HA-900', quantity: 10, unitPrice: 100 }],
  ...extra
  })
  await assignEngineer(finance, bill.id, { engineerId: ENGINEER_ID })
  return bill
}

test('成本中心比例：合计必须为 100%，否则拒绝', async () => {
  await assert.rejects(() => makeBill(undefined, {
    costCenters: [{ name: 'M57', ratio: 60 }, { name: 'G91', ratio: 30 }]
  }), err => err.code === 'COST_CENTER_TOTAL_INVALID')

  await assert.rejects(() => makeBill(undefined, {
    costCenters: [{ name: 'M57', ratio: 60 }, { name: 'G91', ratio: 50 }]
  }), err => err.code === 'COST_CENTER_TOTAL_INVALID')

  await assert.rejects(() => makeBill(undefined, {
    costCenters: [{ name: '', ratio: 100 }]
  }), err => err.status === 422)

  await assert.rejects(() => makeBill(undefined, {
    costCenters: [{ name: 'M57', ratio: 120 }]
  }), err => err.status === 422)

  // 合计正好 100% 通过，并可回读
  const ok = await makeBill(undefined, {
    costCenters: [{ name: 'M57', ratio: 60 }, { name: 'G91', ratio: 40 }]
  })
  // 占比与分摊金额都要落库（1000 元 → M57 600 / G91 400）
  assert.deepEqual(ok.costCenters, [
    { name: 'M57', ratio: 60, amount: 600 },
    { name: 'G91', ratio: 40, amount: 400 }
  ])
  const detail = await getBillDetail(pm, ok.id)
  assert.equal(detail.costCenters.length, 2)
  // 三位小数合计 100 也接受（60.005+39.995）
  const ok2 = await makeBill(undefined, {
    costCenters: [{ name: 'A', ratio: 33.33 }, { name: 'B', ratio: 33.33 }, { name: 'C', ratio: 33.34 }]
  })
  assert.equal(ok2.costCenters.length, 3)
})

test('增幅校验：≤3.5% 放行，>3.5% 拦截并推送报警',  () => {
  assert.equal(MAX_INCREASE_RATE, 0.035)
  assert.equal(increaseCheck({ totalAmount: 1000, finance: { payableAmount: 1035 } }).exceeded, false, '恰好 3.5% 不算超限')
  assert.equal(increaseCheck({ totalAmount: 1000, finance: { payableAmount: 1000 } }).ratePercent, 0)
  assert.equal(increaseCheck({ totalAmount: 1000, finance: { payableAmount: 900 } }).exceeded, false, '金额下降不受限')
  const over = increaseCheck({ totalAmount: 1000, finance: { payableAmount: 1050 } })
  assert.equal(over.exceeded, true)
  assert.equal(over.ratePercent, 5)
  assert.equal(over.limitPercent, 3.5)
})

test('增幅超限时：财务确认被拦截，且产生报警通知', async () => {
  // 供应商提交 1000（10 × 100）
  const bill = await makeBill()
  await confirmBill(bizEngineer, bill.id, {})

  // 财务核算把应付金额加到 1050（+5%，超 3.5%）
  await calculateBill(finance, bill.id, { deduction: -50, taxRate: 0 })
  const detail = await getBillDetail(pm, bill.id)
  assert.equal(detail.finance.payableAmount, 1050)
  assert.equal(detail.increaseCheck.exceeded, true, '详情应带出超限标记供前端提示')

  const mark = notifications.length
  await assert.rejects(
    () => confirmBill(finance, bill.id, { comment: '金额核对' }),
    err => err.code === 'INCREASE_LIMIT_EXCEEDED'
  )
  // 拦截后单据不应前进
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_FINANCE', '状态保持不变')
  // 已推送报警（站内 + 飞书同一入口）
  const alerts = notifications.slice(mark).filter(n => (n.title || '').includes('增幅超限'))
  assert.equal(alerts.length >= 1, true, '应产生超限报警通知')
  assert.match(alerts[0].content, /供应商提交金额/)
  assert.match(alerts[0].content, /上限 3.5%/)

  // 调整到阈值内后可正常提交
  await calculateBill(finance, bill.id, { deduction: -30, taxRate: 0 })
  assert.equal((await getBillDetail(pm, bill.id)).finance.payableAmount, 1030)
  const done = await confirmBill(finance, bill.id, {})
  assert.equal(done.status, 'PENDING_SETTLEMENT', '财务后进入统结方节点')
})

test('增幅校验以「供应商提交金额」为基准，扣款/税率后金额下降不受限', async () => {
  const bill = await makeBill([{ taskName: 'HA-901', quantity: 20, unitPrice: 50 }]) // 1000
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 200, taxRate: 6 }) // (1000-200)*1.06 = 848
  const detail = await getBillDetail(pm, bill.id)
  assert.equal(detail.finance.payableAmount, 848)
  assert.equal(detail.increaseCheck.exceeded, false)
  assert.equal((await confirmBill(finance, bill.id, {})).status, 'PENDING_SETTLEMENT')
  const row = listBills(pm, new URLSearchParams()).items.find(b => b.id === bill.id)
  assert.equal(row.payableAmount, 848)
})

// ===== 统一结算（柏川=统一结算方）：供应商确认合计 vs 统结方提交总金额 =====
test('统一结算：供应商确认金额合计可按周期/供应商/项目汇总', async () => {
  const { computeSupplierConfirmedTotal } = await import('../server/services/bills.js')
  const b1 = await createBill(supplierA, {
    projectId: PROJECT_ID, batchName: '统结-批次A', period: '2031-01', importMode: 'paste',
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    costCenters: [{ name: 'M57', ratio: 100 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    items: [{ taskName: 'T-1', quantity: 10, unitPrice: 100 }]
  })
  const b2 = await createBill(supplierA, {
    projectId: PROJECT_ID, batchName: '统结-批次B', period: '2031-01', importMode: 'paste',
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    costCenters: [{ name: 'M57', ratio: 100 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    items: [{ taskName: 'T-2', quantity: 5, unitPrice: 200 }]
  })
  const scope = computeSupplierConfirmedTotal({ period: '2031-01' })
  assert.equal(scope.supplierTotal, 2000, '1000 + 1000')
  assert.equal(scope.billCount, 2)
  assert.equal(scope.supplierCount, 1)
  assert.equal(scope.suppliers[0].supplierName, supplierA.userName, '按姓名归集')
  // 供应商维度筛选也走姓名（supplierIds 已废弃）
  assert.equal(computeSupplierConfirmedTotal({ period: '2031-01', supplierNames: [supplierA.userName] }).supplierTotal, 2000)
  assert.equal(computeSupplierConfirmedTotal({ period: '2031-01', supplierNames: ['不存在的供应商'] }).billCount, 0)
  // 单号回读确认
  const ids = listBills(pm, new URLSearchParams({ period: '2031-01' })).items.map(x => x.billNo)
  assert.equal(ids.includes(b1.billNo) && ids.includes(b2.billNo), true)
})

test('统一结算：统结方提交总金额增幅超 3.5% → 报警且提交不了', async () => {
  const { checkTotalSubmission } = await import('../server/services/bills.js')
  const scope = { period: '2031-01' }

  // 恰好 +3.5%：放行
  const ok = checkTotalSubmission(finance, { ...scope, submittedTotal: 2070, submittedBy: '柏川' })
  assert.equal(ok.exceeded, false)
  assert.equal(ok.ratePercent, 3.5)

  // +5%：拦截 + 报警
  const mark = notifications.length
  await assert.rejects(
    () => Promise.resolve().then(() => checkTotalSubmission(finance, { ...scope, submittedTotal: 2100, submittedBy: '柏川' })),
    err => err.code === 'INCREASE_LIMIT_EXCEEDED'
  )
  const alerts = notifications.slice(mark).filter(n => (n.title || '').includes('统一结算增幅超限'))
  assert.equal(alerts.length >= 1, true, '应产生统结超限报警')
  assert.match(alerts[0].content, /供应商确认金额合计/)
  assert.match(alerts[0].content, /统结方提交总金额/)
  assert.match(alerts[0].content, /柏川/)

  // 低于合计不受限；非法金额拒绝
  assert.equal(checkTotalSubmission(finance, { ...scope, submittedTotal: 1900 }).exceeded, false)
  assert.throws(() => checkTotalSubmission(finance, { ...scope, submittedTotal: -1 }), err => err.status === 422)
  assert.throws(() => checkTotalSubmission(finance, { ...scope, submittedTotal: 'abc' }), err => err.status === 422)
})

// ===== 附件引用：白名单内的类型都可通过（Word/PDF 曾经被漏掉）=====
test('附件引用：xlsx/csv/docx/pdf 都能建单，伪造引用被拒', async () => {
  const { createBill: create } = await import('../server/services/bills.js')
  const mk = (storedName) => create(supplierA, {
    projectId: PROJECT_ID, batchName: '附件类型-' + storedName.split('.').pop(), period: '2034-01', importMode: 'excel',
    costCenters: [{ name: '端到端项目', amount: 100 }],
    attachments: [{ storedName, originalName: 'f.' + storedName.split('.').pop(), size: 1 }],
    items: [{ taskName: 'T', quantity: 1, unitPrice: 100 }]
  })
  for (const name of ['bills/a1.docx', 'bills/a2.doc', 'bills/a3.pdf', 'bills/a4.xlsx', 'bills/a5.csv']) {
    const bill = await mk(name)
    assert.equal(bill.attachments[0].storedName, name, `${name} 应被接受`)
  }
  // 伪造/越权引用仍必须被拒
  await assert.rejects(() => mk('bills/../../etc/passwd'), err => err.status === 422)
  await assert.rejects(() => mk('bills/a6.exe'), err => err.status === 422)
})

// ===== 成本中心分摊与报表 =====
test('成本中心：金额按占比分摊，末位吸收舍入差额，合计精确等于金额', async () => {
  const { allocateCostCenters, costCenterReport, createBill: create } = await import('../server/services/bills.js')
  const a = allocateCostCenters([{ name: 'M57', ratio: 60 }, { name: 'G91', ratio: 40 }], 1000)
  assert.deepEqual(a, [{ name: 'M57', ratio: 60, amount: 600 }, { name: 'G91', ratio: 40, amount: 400 }])

  const b = allocateCostCenters([{ name: 'A', ratio: 33.33 }, { name: 'B', ratio: 33.33 }, { name: 'C', ratio: 33.34 }], 1000.05)
  assert.equal(Number(b.reduce((s, x) => s + x.amount, 0).toFixed(2)), 1000.05, '分摊合计必须精确')

  // 建单时即写入分摊金额
  const bill = await create(supplierA, {
    projectId: PROJECT_ID, batchName: '成本中心-批次', period: '2032-03', importMode: 'paste',
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    costCenters: [{ name: 'M57', ratio: 70 }, { name: 'G91', ratio: 30 }],
    items: [{ taskName: 'CC-1', quantity: 10, unitPrice: 100 }]
  })
  await assignEngineer(finance, bill.id, { engineerId: ENGINEER_ID })
  assert.deepEqual(bill.costCenters, [{ name: 'M57', ratio: 70, amount: 700 }, { name: 'G91', ratio: 30, amount: 300 }])

  // 财务核算改变金额后，分摊随之重算
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  const detail = await getBillDetail(pm, bill.id)
  assert.equal(detail.costCenters[0].amount, 700)
  assert.equal(detail.costCenters.reduce((s, x) => s + x.amount, 0), 1000)

  // 按成本中心报表
  const report = costCenterReport(pm, { period: '2032-03' })
  assert.equal(report.totalAmount, 1000)
  const m57 = report.costCenters.find(x => x.name === 'M57')
  assert.equal(m57.amount, 700)
  assert.equal(m57.billCount, 1)
  assert.equal(m57.supplierCount, 1)
  assert.equal(report.costCenters[0].name, 'M57', '按金额降序')
})

test('抄送统结方：末节点通过后推送飞书+站内待办', async () => {
  const { notifications } = await import('../server/repositories/data.js')
  const leader = { id: 305, roleType: 15, supplierId: null, userName: '负责人' }
  const perception = { id: 306, roleType: 16, supplierId: null, userName: '算法' }
  const bill = await makeBill([{ taskName: 'CC-2', quantity: 10, unitPrice: 10 }])
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, bill.id, {})
  await confirmParty(bill)
  await confirmBill(leader, bill.id, {})

  const mark = notifications.length
  await confirmBill(perception, bill.id, {})
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_OA')
  const done = await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, bill.id, {})
  assert.equal(done.status, 'APPROVED')

  let created = notifications.slice(mark)
  let notice = created.find(n => /结算完成/.test(n.title || ''))
  assert.ok(notice, '应生成结算完成通知')
  assert.match(notice.title, /结算完成/)
  assert.match(notice.content, /当前供应商确认合计/)
  // 尚未指定统一结算方时：只发给内部跟进，不群发全体供应商
  const supplierIds = users.filter(u => !u.disabled && hasRole(u, 3)).map(u => u.id)
  assert.equal(created.some(n => n.type === 'todo' && n.userIds.some(id => supplierIds.includes(id))), false,
    '未指定统结方时不应把待办发给供应商账号')

  // 指定「统一结算方」账号后：待办直达该账号 + 内部同步一条"已抄送"
  const partyAccount = users.find(u => !u.disabled && hasRole(u, 3))
  partyAccount.isSettlementParty = true
  try {
    const bill2 = await makeBill([{ taskName: 'CC-3', quantity: 10, unitPrice: 10 }])
    await confirmBill(bizEngineer, bill2.id, {})
    await calculateBill(finance, bill2.id, { deduction: 0, taxRate: 0 })
    await confirmBill(finance, bill2.id, {})
    await confirmParty(bill2)
    await confirmBill(leader, bill2.id, {})
    const mark2 = notifications.length
    await confirmBill(perception, bill2.id, {})
    await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, bill2.id, {})
    created = notifications.slice(mark2)
    notice = created.find(n => /结算完成/.test(n.title || ''))
    assert.ok(notice, '应生成结算完成通知')
    assert.equal(notice.userIds.includes(partyAccount.id), true, '完成通知应直达统一结算方账号')
    // 口径：消息里一律「角色-姓名」，标题带上统结方姓名
    assert.equal(created.some(n => (n.title || '').includes(`已抄送 统结方-${partyAccount.userName}`)), true, '内部同步一份并点名统结方')
  } finally {
    delete partyAccount.isSettlementParty
  }
})

// ===== 统结方节点：提交总金额 + 3.5% 对比 =====
test('统结方提交（导入解析）→ 财务二次确认：超 3.5% 报警且拦截，改正后放行', async () => {
  const { notifications } = await import('../server/repositories/data.js')
  const { calculateBill: calc, resubmitSettlement } = await import('../server/services/bills.js')
  const bill = await makeBill([{ taskName: 'ST-1', quantity: 10, unitPrice: 100 }], { period: '2033-05' })
  await confirmBill(bizEngineer, bill.id, {})
  await calc(finance, bill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, bill.id, {})
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_SETTLEMENT')

  // 统结方什么都不交 → 拒绝
  await assert.rejects(() => confirmBill(party, bill.id, {}), err => err.code === 'SETTLEMENT_REQUIRED')

  // 详情带出「供应商确认金额合计」供界面实时对比
  const detail = await getBillDetail(party, bill.id)
  assert.ok(detail.supplierConfirmedTotal.supplierTotal > 0, '应返回供应商确认合计')
  const base = detail.supplierConfirmedTotal.supplierTotal

  // 导入解析明细提交（系统自动汇总金额），本环节不再拦截超限
  const overPrice = Number((base * 1.2).toFixed(2))          // 明细汇总后比供应商合计高 20%
  const submitted = await confirmBill(party, bill.id, {
    items: [{ taskName: '统结明细-A', unit: '帧', quantity: 1, unitPrice: overPrice }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: '统结附件.csv', size: 1 }],
    comment: '导入统结数据'
  })
  assert.equal(submitted.status, 'PENDING_FINANCE2', '提交后进入财务二次确认')
  const rec = submitted.confirms.find(c => c.stageKey === 'SETTLEMENT')
  assert.ok(rec?.settlement, '应记录统结提交明细')
  assert.equal(rec.settlement.source, 'import')
  assert.equal(rec.settlement.submittedTotal, overPrice, '金额由明细自动汇总')
  assert.equal(rec.settlement.supplierTotal, base)

  // 财务二次确认：增幅超 3.5% → 报警 + 拦截，状态不前进
  const mark = notifications.length
  await assert.rejects(() => confirmBill(finance, bill.id, {}), err => err.code === 'INCREASE_LIMIT_EXCEEDED')
  assert.equal(notifications.slice(mark).some(n => (n.title || '').includes('统结增幅超限')), true, '应推送报警')
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_FINANCE2', '状态不前进')

  // 统结方改正后重新提交（不必整单退回供应商）→ 财务二次确认通过
  const fixed = await resubmitSettlement(party, bill.id, {
    items: [{ taskName: '统结明细-A', unit: '帧', quantity: 1, unitPrice: Number((base * 1.02).toFixed(2)) }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: '统结附件.csv', size: 1 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: '统结附件.csv', size: 1 }]
  })
  assert.equal(fixed.status, 'PENDING_FINANCE2')
  const rec2 = fixed.confirms.find(c => c.stageKey === 'SETTLEMENT')
  assert.equal(rec2.settlement.increasePercent, 2, '重新提交后增幅 2%')
  const passed = await confirmBill(finance, bill.id, {})
  assert.equal(passed.status, 'PENDING_LEADER')
  const cmp = passed.confirms.find(c => c.stageKey === 'FINANCE2')?.comparison
  assert.ok(cmp, '二次确认应记录对比结果')
  assert.equal(cmp.base, base)
  assert.equal(cmp.exceeded, false)
  assert.equal(cmp.ratePercent, 2)
})

// ===== 独立结算身份（角色 19）：与统结方无合同关系的供应商 =====
// 其单据财务确认后直接进入负责人，跳过「统结方提交」与配套的「财务二次确认」
test('独立结算身份：财务后直达负责人，且不计入统结对比基数', async () => {
  const EXEMPT = '康尼瑞行'
  // 身份由账号角色驱动：给该供应商账号勾选「独立结算」(19) 即可，无需改代码
  const exemptUser = { id: 310, roleType: 3, roleTypes: [3, 19], userName: EXEMPT }
  if (!users.some(u => u.id === 310)) {
    users.push({ id: 310, username: 'kognic_t', userName: EXEMPT, roleType: 3, roleTypes: [3, 19], disabled: false })
  }
  const perception = { id: 311, roleType: 16, roleTypes: [16], userName: '算法' }
  const partyUploader = { ...party, roleTypes: [3, 17] }   // 统结方也要能上传（生产上是 [3,17]）
  const PERIOD = '2033-11'

  const mk = async (user, price) => {
    const b = await createBill(user, {
      projectId: PROJECT_ID,
      batchName: '豁免批次-' + (++seq),
      period: PERIOD,
      attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
      costCenters: [{ name: 'M57', ratio: 100 }],
      items: [{ taskName: 'K-1', quantity: 10, unitPrice: price }]
    })
    await assignEngineer(finance, b.id, { engineerId: ENGINEER_ID })
    return b
  }

  const exemptBill = await mk(exemptUser, 100)
  const normalBill = await mk(supplierA, 200)

  // 1) 链路只剩 5 个环节：工程师 → 财务 → 负责人 → 算法 → OA
  const row = listBills(pm, new URLSearchParams({ pageSize: '100' })).items.find(b => b.id === exemptBill.id)
  assert.deepEqual(row.chain.map(c => c.key), ['BIZ', 'FINANCE', 'LEADER', 'PERCEPTION', 'OA'])
  assert.equal(row.stageCount, 5, '环节总数应为 5')

  // 2) 财务确认后直达负责人（关键：不经过统结方与财务二次确认）
  await confirmBill(bizEngineer, exemptBill.id, {})
  assert.equal((await getBillDetail(pm, exemptBill.id)).status, 'PENDING_FINANCE')
  await calculateBill(finance, exemptBill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, exemptBill.id, {})

  const afterFinance = await getBillDetail(pm, exemptBill.id)
  assert.equal(afterFinance.status, 'PENDING_LEADER', '财务后应直接到负责人')
  assert.deepEqual(afterFinance.stages.map(s => s.key), ['BIZ', 'FINANCE', 'LEADER', 'PERCEPTION', 'OA'])
  assert.equal(afterFinance.chainIndex, 2, '当前环节在链中的位置应为负责人')

  // 3) 统结方不是本单链路角色 → 无权确认
  await assert.rejects(() => confirmBill(party, exemptBill.id, {}), err => err.code === 'FORBIDDEN')

  // 4) 后续环节照常走完，chainIndex 归位到链长
  await confirmBill(leader, exemptBill.id, {})
  assert.equal((await getBillDetail(pm, exemptBill.id)).status, 'PENDING_PERCEPTION')
  await confirmBill(perception, exemptBill.id, {})
  await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, exemptBill.id, {})
  const done = await getBillDetail(pm, exemptBill.id)
  assert.equal(done.status, 'APPROVED')
  assert.equal(done.chainIndex, 5, '走完后 chainIndex = 链长')

  // 5) 统结对比基数：不含免统结供应商，仍含普通供应商
  const partyBill = await mk(partyUploader, 300)
  const pb = await getBillDetail(party, partyBill.id)
  const baseNames = pb.supplierConfirmedTotal.suppliers
  assert.equal(baseNames.includes(EXEMPT), false, '康尼瑞行不应计入统结对比基数')
  assert.equal(baseNames.includes(supplierA.userName), true, '普通供应商应计入统结对比基数')
  assert.equal(normalBill.status, 'PENDING_BIZ')

  // 6) 身份来自角色：给原本走统结的供应商也勾上「独立结算」→ 新单即跳过统结环节
  const promoted = users.find(u => u.userName === supplierA.userName)
  const backup = promoted.roleTypes
  promoted.roleTypes = [...new Set([...(promoted.roleTypes || [promoted.roleType]), 19])]
  const promotedBill = await mk(supplierA, 400)
  const promotedRow = listBills(pm, new URLSearchParams({ pageSize: '100' })).items.find(b => b.id === promotedBill.id)
  assert.deepEqual(promotedRow.chain.map(c => c.key), ['BIZ', 'FINANCE', 'LEADER', 'PERCEPTION', 'OA'],
    '勾选独立结算后新单应跳过统结环节')
  promoted.roleTypes = backup   // 还原，避免影响其他用例
})

// ===== 数据仪表盘金额口径：优先统结方提交金额，未统结的退回单据自己的金额 =====
test('仪表盘金额口径：有统结提交用统结金额，未统结用单据金额', async () => {
  const PERIOD = '2033-12'
  const mk = async (price) => {
    const b = await createBill(supplierA, {
      projectId: PROJECT_ID,
      batchName: '口径批次-' + (++seq),
      period: PERIOD,
      attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
      costCenters: [{ name: 'M57', ratio: 100 }],
      items: [{ taskName: 'K-1', quantity: 10, unitPrice: price }]
    })
    await assignEngineer(finance, b.id, { engineerId: ENGINEER_ID })
    return b
  }

  // 普通供应商走完整链路到统结方节点 → 柏川提交统结金额（比供应商金额高 100）
  const bill = await mk(100)                             // 单据金额 1000
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, bill.id, {})
  const afterFinance = await getBillDetail(finance, bill.id)
  assert.equal(afterFinance.status, 'PENDING_SETTLEMENT')
  // 统结尚未提交：解析结果为空 → 报表退回用单据自己的金额
  assert.equal(settlementSubmittedOf(afterFinance), null, '统结方未提交时应为空')
  const beforeRow = settlementSummary(finance, { period: PERIOD }).suppliers.find(x => x.supplierName === supplierA.userName)
  assert.equal(beforeRow.amount, 1000, '统结前应用单据自己的金额（应付金额）')

  await confirmBill(party, bill.id, {
    items: [{ taskName: '统结明细', quantity: 1, unitPrice: 1100 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 's.csv', size: 1 }]
  })
  const submitted = await getBillDetail(finance, bill.id)
  assert.equal(settlementSubmittedOf(submitted), 1100, '统结方提交金额应被解析出来')

  // 报表口径：该单金额取统结金额 1100，而不是单据金额 1000
  const summary = settlementSummary(finance, { period: PERIOD })
  const row = summary.suppliers.find(x => x.supplierName === supplierA.userName)
  assert.ok(row, '应能在供应商维度找到该供应商')
  assert.equal(row.amount, 1100, '累计金额应取统结方提交金额')
  assert.equal(row.baseAmount, 1000, '基础金额仍为单据原始金额（明细不变）')
})

// ===== 仪表盘成本中心：按统结金额 × 供应商原比例重算 =====
test('成本中心金额：以统结方金额为基数按原比例重算，合计等于统结金额', async () => {
  const PERIOD = '2034-01'
  const bill = await createBill(supplierA, {
    projectId: PROJECT_ID,
    batchName: '成本中心口径-' + (++seq),
    period: PERIOD,
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    costCenters: [{ name: 'M57', ratio: 60 }, { name: 'G91', ratio: 40 }],
    items: [{ taskName: 'K-1', quantity: 10, unitPrice: 100 }]      // 单据金额 1000
  })
  await assignEngineer(finance, bill.id, { engineerId: ENGINEER_ID })
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, bill.id, {})

  // 统结前：按单据金额 1000 分摊 → 600 / 400
  const before = settlementSummary(finance, { period: PERIOD }).costCenters
  assert.equal(before.find(c => c.name === 'M57').amount, 600)
  assert.equal(before.find(c => c.name === 'G91').amount, 400)

  // 柏川提交 1030（较 1000 增幅 3%，在 3.5% 红线内）
  await confirmBill(party, bill.id, {
    items: [{ taskName: '统结明细', quantity: 1, unitPrice: 1030 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 's.csv', size: 1 }]
  })

  // 统结后：同一比例，基数换成 1030 → 618 / 412，合计恰为 1030
  const after = settlementSummary(finance, { period: PERIOD }).costCenters
  const m57 = after.find(c => c.name === 'M57')
  const g91 = after.find(c => c.name === 'G91')
  assert.equal(m57.amount, 618, '1030 × 60%')
  assert.equal(g91.amount, 412, '1030 × 40%')
  assert.equal(Number((m57.amount + g91.amount).toFixed(2)), 1030, '成本中心合计应等于统结金额')
  assert.equal(m57.avgRatio, 60, '比例仍是供应商原填值，未被改动')
  assert.equal(g91.avgRatio, 40)
})

// ===== 供应商 × 成本中心 分布：同一供应商的多个成本中心分别统计 =====
test('供应商分布：按供应商×成本中心分组，金额等于该成本中心分摊额', async () => {
  const PERIOD = '2034-03'
  const bill = await createBill(supplierA, {
    projectId: PROJECT_ID,
    batchName: '成本中心分布-' + (++seq),
    period: PERIOD,
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    costCenters: [{ name: 'M57', ratio: 70 }, { name: 'G91', ratio: 30 }],
    items: [{ taskName: 'K-1', quantity: 10, unitPrice: 100 }]      // 1000 → M57 700 / G91 300
  })
  await assignEngineer(finance, bill.id, { engineerId: ENGINEER_ID })

  const dist = settlementSummary(finance, { period: PERIOD }).supplierCostCenters
  const mine = dist.filter(r => r.supplierName === supplierA.userName)
  assert.equal(mine.length, 2, '同一供应商的两个成本中心应各有一行')
  assert.deepEqual(mine.map(r => r.costCenter).sort(), ['G91', 'M57'])

  const m57 = mine.find(r => r.costCenter === 'M57')
  const g91 = mine.find(r => r.costCenter === 'G91')
  assert.equal(m57.amount, 700, 'M57 分摊 70%')
  assert.equal(g91.amount, 300, 'G91 分摊 30%')
  assert.equal(m57.pendingAmount, 700, '未通过的单计入未结')
  assert.equal(m57.settledAmount, 0)

  // 与成本中心汇总口径一致
  const cc = settlementSummary(finance, { period: PERIOD }).costCenters
  assert.equal(cc.find(c => c.name === 'M57').amount, 700)
  assert.equal(Number((m57.amount + g91.amount).toFixed(2)), 1000, '各成本中心之和 = 单据金额')
})
