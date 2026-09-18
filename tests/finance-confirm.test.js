// 验收结算确认流冒烟测试：四级正向流转、跳步、权限隔离、驳回回流、金额计算
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../server/config.js'
import { feishuConfig, projects, notifications, users } from '../server/repositories/data.js'
import { hasAnyRole } from '../server/lib/roles.js'
// 单元测试绝不触碰真实 MySQL：强制财务域走内存回退
config.db.enabled = false
import { createBill, confirmBill, rejectBill, resubmitBill, deleteBill, updateBill, getBillDetail, listBills, billStats, calculateBill, assignEngineer } from '../server/services/bills.js'

// 测试进程内关闭飞书推送，避免向外发请求
feishuConfig.enabled = false

// 结算以项目为导向：每张结算单必须归属项目
projects.push({ id: 901, name: '测试项目-杭州城区', clientName: '测试客户', status: 'active' })
const PROJECT_ID = 901

// 供应商身份以「姓名」为准：用种子里真实的供应商账号，单据 owner 即该账号显示名
const seedSupplier = users.find(u => !u.disabled && hasAnyRole(u, [3]))
assert.ok(seedSupplier, '种子账号里应有供应商角色账号')
const supplierA = { id: seedSupplier.id, roleType: 3, roleTypes: [3], userName: seedSupplier.userName }
// 改派用例需要第二个工程师账号（内存 seed 里只有 id=21 一个工程师）
const SECOND_ENGINEER_ID = 902
users.push({ id: SECOND_ENGINEER_ID, username: 'eng_b', userName: '赵晓伟', roleType: 13, roleTypes: [13], disabled: false })
// OA 结算专员账号（末环节，彭桂苹）
const OA_ID = 903
users.push({ id: OA_ID, username: 'oa_t', userName: '彭桂苹', roleType: 18, roleTypes: [18], disabled: false })
const supplierB = { id: 202, roleType: 3, roleTypes: [3], userName: '供应商B交付员' }
// 指派校验会到 users 集合里核对，故用真实存在的工程师账号 id
const ENGINEER_ID = 21
const bizEngineer = { id: ENGINEER_ID, roleType: 13, roleTypes: [13], supplierId: null, userName: '业务工程师' }
const finance = { id: 204, roleType: 14, supplierId: null, userName: '财务专员' }
const leader = { id: 205, roleType: 15, supplierId: null, userName: '项目负责人' }
const party = { id: 209, roleType: 17, roleTypes: [17], supplierId: null, userName: '柏川' }
const perception = { id: 206, roleType: 16, supplierId: null, userName: '感知工程师' }
const pm = { id: 207, roleType: 1, supplierId: null, userName: '管理员' }

// 统结方确认助手：按当前"供应商确认合计"等额提交（增幅 0%，必然在 3.5% 红线内）
// 统结方导入提交 → 财务二次确认（链上现在是两步）
// 统结方：导入明细 + 附件（金额由明细自动汇总）→ 财务二次确认
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
async function makeBill(user = supplierA, items) {
  return await createBill(user, {
    projectId: PROJECT_ID,
    batchName: '验收批次-' + (++seq),
    period: '2026-08',
    period: '2026-08',
    remark: '',
    importMode: 'paste',
    sourceFileName: 'batch.csv',
    // 防呆要求：必须带明细数据附件 + 成本中心（合计 100%）
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'batch.csv', size: 10 }],
    costCenters: [{ name: 'M57', ratio: 100 }],
    items: items || [
      { taskName: 'HA-001', dataType: 'GND建图数据', acceptDate: '2026-08-10', quantity: 10, unitPrice: 100 },
      { taskName: 'HA-002', dataType: 'GND建图数据', acceptDate: '2026-08-11', quantity: 5, unitPrice: 100 }
    ]
  })
}

// 供应商提交后由财务指派工程师，工程师才能确认
async function makeAssignedBill(user = supplierA, items) {
  const bill = await makeBill(user, items)
  await assignEngineer(finance, bill.id, { engineerId: ENGINEER_ID })
  return bill
}

test('正向流转：上传 → 业务工程师 → 财务 → 统结方提交 → 财务二次确认 → 负责人 → 算法 → 已通过', async () => {
  const bill = await makeAssignedBill()
  assert.equal(bill.status, 'PENDING_BIZ')
  assert.equal(bill.totalAmount, 1500)
  assert.equal(bill.itemCount, 2)
  assert.equal(bill.projectId, PROJECT_ID)
  assert.equal(bill.projectName, '测试项目-杭州城区')

  await confirmBill(bizEngineer, bill.id, { comment: '数据已核对' })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_FINANCE')

  // 财务节点必须先核算：未核算直接确认会被拒
  await assert.rejects(() => confirmBill(finance, bill.id, {}), err => err.code === 'FINANCE_CALC_REQUIRED')
  const calc = await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  assert.equal(calc.finance.payableAmount, 1500)
  await confirmBill(finance, bill.id, { comment: '金额无误' })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_SETTLEMENT')

  // 统结方提交后，先由财务做二次确认（汇总对比），才流转到负责人
  await confirmBill(party, bill.id, {
    items: [{ taskName: '统结明细', quantity: 1, unitPrice: 1500 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: '统结附件.csv', size: 1 }],
    comment: '已提交统结数据'
  })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_FINANCE2')
  await confirmBill(finance, bill.id, { comment: '汇总核对无误' })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_LEADER')

  await confirmBill(leader, bill.id, {})
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_PERCEPTION')

  await confirmBill(perception, bill.id, { comment: '可入感知库' })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_OA')
  const done = await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, bill.id, { comment: 'OA 已录入' })
  assert.equal(done.status, 'APPROVED')
  // 7 个确认节点 + 供应商提交这一条起点记录
  assert.equal(done.confirms.length, 8)
  assert.ok(done.approvedAt)
  assert.deepEqual(done.confirms.map(c => c.stageKey),
    ['SUPPLIER', 'BIZ', 'FINANCE', 'SETTLEMENT', 'FINANCE2', 'LEADER', 'PERCEPTION', 'OA'])
  assert.equal(done.confirms[0].stageLabel, '供应商提交')
  assert.equal(done.confirms[0].userName, supplierA.userName)
})

test('以项目为导向：缺项目 / 项目不存在 均拒绝；可按项目筛选与汇总', async () => {
  await assert.rejects(() => createBill(supplierA, { batchName: 'x', items: [{ taskName: 'A' }] }),
    err => err.code === 'VALIDATION_ERROR')
  await assert.rejects(() => createBill(supplierA, { projectId: 99999, batchName: 'x', items: [{ taskName: 'A' }] }),
    err => err.code === 'VALIDATION_ERROR')

  const bill = await makeAssignedBill()
  const filtered = listBills(pm, new URLSearchParams({ projectId: String(PROJECT_ID) }))
  assert.equal(filtered.items.some(b => b.id === bill.id), true)
  const other = listBills(pm, new URLSearchParams({ projectId: '99999' }))
  assert.equal(other.items.some(b => b.id === bill.id), false)

  const projectRow = billStats(pm).projects.find(p => p.projectId === PROJECT_ID)
  assert.ok(projectRow, '项目维度汇总应包含该项目')
  assert.equal(projectRow.projectName, '测试项目-杭州城区')
  assert.equal(projectRow.billCount >= 1, true)
})

test('禁止跳步：业务工程师未确认前财务不能确认', async () => {
  const bill = await makeAssignedBill()
  await assert.rejects(() => confirmBill(finance, bill.id, {}), err => err.code === 'FORBIDDEN')
  await assert.rejects(() => confirmBill(perception, bill.id, {}), err => err.code === 'FORBIDDEN')
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_BIZ')
})

test('非确认链角色不能确认（供应商/管理员 无确认权）', async () => {
  const bill = await makeAssignedBill()
  await assert.rejects(() => confirmBill(supplierA, bill.id, {}), err => err.code === 'FORBIDDEN')
  await assert.rejects(() => confirmBill(pm, bill.id, {}), err => err.code === 'FORBIDDEN')
})

test('数据隔离：供应商B不能访问或确认供应商A的结算单', async () => {
  const bill = await makeAssignedBill(supplierA)
  await assert.rejects(() => getBillDetail(supplierB, bill.id), err => err.code === 'SUPPLIER_DATA_FORBIDDEN')
  await assert.rejects(() => deleteBill(supplierB, bill.id), err => err.code === 'SUPPLIER_DATA_FORBIDDEN')
  const listB = listBills(supplierB, new URLSearchParams())
  assert.equal(listB.items.some(b => b.id === bill.id), false)
})

test('驳回：原因必填，驳回后供应商修正并重新提交，确认链从头开始', async () => {
  const bill = await makeAssignedBill()
  await confirmBill(bizEngineer, bill.id, {})
  await assert.rejects(() => rejectBill(finance, bill.id, {}), err => err.code === 'REJECT_REASON_REQUIRED')

  const rejected = await rejectBill(finance, bill.id, { reason: '单价与合同不符' })
  assert.equal(rejected.status, 'REJECTED')
  assert.equal(rejected.rejections.length, 1)

  // 驳回后未重新提交时仍不可确认
  await assert.rejects(() => confirmBill(finance, bill.id, {}), err => err.code === 'BILL_ALREADY_REJECTED')

  const resubmitted = await resubmitBill(supplierA, bill.id)
  assert.equal(resubmitted.status, 'PENDING_BIZ')
  assert.equal(resubmitted.currentStage, 0)
  assert.equal(resubmitted.resubmitCount, 1)
  // 历史确认记录保留，不覆盖（另加供应商提交/重新提交两条记录）
  assert.equal(resubmitted.confirms.filter(c => c.action !== 'SUBMIT').length, 1)
  const submits = resubmitted.confirms.filter(c => c.action === 'SUBMIT')
  assert.equal(submits.length, 2, '首次提交 + 重新提交各一条')
  assert.deepEqual(submits.map(c => c.stageLabel), ['供应商提交', '供应商重新提交'])
  assert.equal(submits[1].userName, supplierA.userName)
})

test('编辑/删除限制：已有确认记录后不可修改或删除', async () => {
  const bill = await makeAssignedBill()
  // 尚无确认记录时可删除
  assert.equal((await deleteBill(supplierA, bill.id)).deleted, true)

  const bill2 = await makeAssignedBill()
  await confirmBill(bizEngineer, bill2.id, {})
  await assert.rejects(() => deleteBill(supplierA, bill2.id), err => err.code === 'BILL_STATE_CONFLICT')
  await assert.rejects(() => confirmBill(bizEngineer, bill2.id, {}), err => err.code === 'FORBIDDEN')
})

test('金额计算：默认公式为 数量×单价；只有金额列时用公式「金额」', async () => {
  // 默认公式：数量 × 单价
  const bill = await makeAssignedBill(supplierA, [
    { taskName: 'A', quantity: 3, unitPrice: 10 },
    { taskName: 'B', quantity: 2, unitPrice: 5 }
  ])
  assert.equal(bill.items[0].amount, 30)
  assert.equal(bill.items[1].amount, 10)
  assert.equal(bill.totalAmount, 40)
  assert.equal(bill.formula, '数量*单价', '未指定公式时落库默认公式')

  // 表里只有金额列时，导入建议公式为「金额」，按金额结算
  const amountOnly = await createBill(supplierA, {
    projectId: PROJECT_ID, batchName: '仅金额列', period: '2026-08', importMode: 'paste',
    costCenters: [{ name: 'M57', ratio: 100 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    formula: '金额',
    items: [{ taskName: 'C', quantity: 0, unitPrice: 0, amount: 250 }]
  })
  assert.equal(amountOnly.items[0].amount, 250)
  assert.equal(amountOnly.totalAmount, 250)

  // 公式结算：数量 × 单价 × 系数
  const withCoef = await createBill(supplierA, {
    projectId: PROJECT_ID, batchName: '带系数', period: '2026-08', importMode: 'paste',
    costCenters: [{ name: 'M57', ratio: 100 }],
    attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    formula: '数量*单价*系数', coefficient: 0.8,
    items: [{ taskName: 'D', quantity: 10, unitPrice: 100 }]
  })
  assert.equal(withCoef.items[0].amount, 800)
  assert.equal(withCoef.formula, '数量*单价*系数')
  assert.equal(withCoef.coefficient, 0.8)

  // 非法公式直接拒绝，不落库
  await assert.rejects(() => createBill(supplierA, {
    projectId: PROJECT_ID, batchName: '非法公式', period: '2026-08', items: [{ taskName: 'E', quantity: 1, unitPrice: 1 }],
    formula: '数量*'
  }), err => err.code === 'FORMULA_INVALID')
})

test('校验：明细为空 / 缺任务名称 / 批次名为空 均拒绝', async () => {
  await assert.rejects(() => createBill(supplierA, { batchName: 'x', attachments: [{ storedName: 'bills/fixture.csv', originalName: 'f.csv', size: 1 }],
    items: [] }), err => err.code === 'VALIDATION_ERROR')
  await assert.rejects(() => createBill(supplierA, { batchName: 'x', items: [{ quantity: 1 }] }), err => err.code === 'VALIDATION_ERROR')
  await assert.rejects(() => createBill(supplierA, { batchName: '', items: [{ taskName: 'A' }] }), err => err.code === 'VALIDATION_ERROR')
})

test('看板统计：待我确认数量按当前节点计算', async () => {
  const financeBefore = billStats(finance).myTodoCount
  const bill = await makeAssignedBill()
  // 新单停在业务工程师节点：业务工程师待办 +1，财务待办不变
  assert.equal(billStats(bizEngineer).myTodoCount >= 1, true)
  assert.equal(billStats(finance).myTodoCount, financeBefore)
  await confirmBill(bizEngineer, bill.id, {})
  assert.equal(billStats(finance).myTodoCount, financeBefore + 1)
})

test('多角色环环相扣：同持业务工程师与财务的账号可依次推进两个节点', async () => {
  // 一个账号同时持有 13(业务工程师) 与 14(财务)
  const multi = { id: ENGINEER_ID, roleType: 13, roleTypes: [13, 14], supplierId: null, userName: '多角色账员' }
  const bill = await makeBill()
  await assignEngineer(finance, bill.id, { engineerId: multi.id })
  const t = listBills(multi, new URLSearchParams({ scope: 'todo' }))
  assert.equal(t.items.some(b => b.id === bill.id), true, '多角色账号应在待我确认中看到该单')

  await confirmBill(multi, bill.id, { comment: '业务工程师节点通过' })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'PENDING_FINANCE')
  // 同一账号接着走财务节点（环环相扣）：先核算，再确认
  await calculateBill(multi, bill.id, { deduction: 100, taxRate: 6 })
  await confirmBill(multi, bill.id, { comment: '财务节点通过' })
  const after = await getBillDetail(pm, bill.id)
  assert.equal(after.status, 'PENDING_SETTLEMENT', '财务后进入统结方节点')
  // 记录里保存的是"以哪个角色动作"
  assert.equal(after.confirms[0].stageKey, 'SUPPLIER')
  assert.deepEqual(after.confirms.slice(1).map(c => c.roleType), [13, 14])
  // 不含统结方角色 → 不能继续推进
  await assert.rejects(() => confirmBill(multi, bill.id, {}), err => err.code === 'FORBIDDEN')
})

test('多角色数据隔离：同持供应商与内部角色的账号可见全部单据', async () => {
  // 单据属于供应商A(101)；两个账号都属于供应商B(102)
  const supplierOnly = { id: 209, roleType: 3, roleTypes: [3], supplierId: 102, userName: '纯供应商' }
  const mixed = { id: 210, roleType: 3, roleTypes: [3, 13], supplierId: 102, userName: '供应商兼业务工程师' }
  const bill = await makeAssignedBill(supplierA)

  const a = listBills(supplierOnly, new URLSearchParams())
  assert.equal(a.items.some(b => b.id === bill.id), false, '纯供应商不应看到他人单据')
  // 纯供应商越权访问 → 403
  await assert.rejects(() => getBillDetail(supplierOnly, bill.id), err => err.code === 'SUPPLIER_DATA_FORBIDDEN')

  const b = listBills(mixed, new URLSearchParams())
  assert.equal(b.items.some(x => x.id === bill.id), true, '含内部角色的账号按内部人员放行')
})

// ===== 环节提醒（站内 + 飞书同一入口，此处校验推送对象与文案）=====
const userIdsOfRole = (role) => users.filter(u => !u.disabled && hasAnyRole(u, [role])).map(u => u.id)
const sentTo = (since, ids) => notifications.slice(since).filter(n => ids.every(id => n.userIds.includes(id)))

test('每个环节都有提醒：推送对象为「下一节点角色」，文案含单号/项目（不展示金额）', async () => {
  const ownerName = supplierA.userName
  const ownerSupplierIds = userIdsOfRole(3).filter(id => users.find(u => u.id === id).userName === ownerName)
  const otherSupplierIds = userIdsOfRole(3).filter(id => users.find(u => u.id === id).userName !== ownerName)
  const bizIds = userIdsOfRole(13)
  const finIds = userIdsOfRole(14)
  const leadIds = userIdsOfRole(15)
  const perIds = userIdsOfRole(16)
  const partyIds = userIdsOfRole(17)
  const pmIds = userIdsOfRole(1)
  assert.ok(bizIds.length && finIds.length && leadIds.length && perIds.length, '种子账号应覆盖四个确认角色')

  // 1) 供应商提交 → 提醒业务工程师
  let mark = notifications.length
  const bill = await makeAssignedBill()
  // 提交时若还没有指派工程师 → 提醒财务去指派；指派后由「指派提醒」通知被指派的人
  assert.equal(sentTo(mark, finIds).length >= 1, true, '提交后应提醒财务指派工程师')
  let hits = notifications.slice(mark).filter(n => n.userIds.includes(ENGINEER_ID))
  assert.equal(hits.length >= 1, true, '指派后应提醒被指派的工程师')
  assert.match(hits[0].title, /工程师/)
  assert.match(hits[0].content, /结算单 YS/)
  assert.match(hits[0].content, /项目：测试项目-杭州城区/)
  assert.ok(!/¥|金额/.test(hits[0].content), '提醒文案不展示金额')

  // 2) 业务工程师确认 → 提醒财务 + 回执提交人
  mark = notifications.length
  await confirmBill(bizEngineer, bill.id, {})
  assert.equal(sentTo(mark, finIds).length >= 1, true, '业务工程师确认后应提醒财务')
  assert.equal(sentTo(mark, [supplierA.id]).length >= 1, true, '应回执单据提交人')

  // 3) 财务确认 → 提醒统一结算方（先核算）
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  mark = notifications.length
  await confirmBill(finance, bill.id, {})
  assert.equal(sentTo(mark, partyIds).length >= 1, true, '财务确认后应提醒统一结算方')
  assert.equal(sentTo(mark, leadIds).length, 0, '未到负责人节点，不应提前提醒')
  assert.equal(sentTo(mark, perIds).length, 0, '此时不应打扰感知工程师')

  // 3.5) 统结方确认 → 提醒负责人
  mark = notifications.length
  await confirmParty(bill)
  assert.equal(sentTo(mark, leadIds).length >= 1, true, '统结方确认后应提醒负责人')

  // 4) 负责人确认 → 提醒感知工程师
  mark = notifications.length
  await confirmBill(leader, bill.id, {})
  assert.equal(sentTo(mark, perIds).length >= 1, true, '负责人确认后应提醒感知工程师')

  // 5) 算法确认 → 提醒 OA 结算专员（末环节）
  const oaIds = userIdsOfRole(18)
  assert.ok(oaIds.length, '种子/夹具里应有 OA 结算专员账号')
  mark = notifications.length
  await confirmBill(perception, bill.id, {})
  assert.equal(sentTo(mark, oaIds).length >= 1, true, '算法确认后应提醒 OA 结算专员')

  // 6) OA 结算专员确认（真正的末节点）→ 回执提交人 + 通知甲方PM + 回执本单供应商
  mark = notifications.length
  await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, bill.id, {})
  assert.equal(sentTo(mark, [supplierA.id]).length >= 1, true, '末节点通过应回执提交人（createdBy）')
  assert.equal(sentTo(mark, pmIds).length >= 1, true, '末节点通过应通知管理员')
  assert.equal(sentTo(mark, ownerSupplierIds).length >= 1, true, '末节点通过应通知本单所属供应商')
  // 关键：只通知本单所属供应商（按姓名匹配），不能群发给其他供应商账号
  assert.ok(otherSupplierIds.length > 0, '种子里应存在其他供应商账号，否则隔离断言无意义')
  assert.equal(sentTo(mark, otherSupplierIds).length, 0, '不应通知其他供应商')
})

// ===== 改派：原工程师退出待办，只有被指派的人能确认 =====
test('改派工程师：原工程师不再算我的待办，待办被清掉且不能确认', async () => {
  const OTHER_ENGINEER = { id: SECOND_ENGINEER_ID, roleType: 13, roleTypes: [13], userName: '赵晓伟' }
  const original = { id: ENGINEER_ID, roleType: 13, roleTypes: [13], userName: '彭晓蕾' }
  const bill = await makeAssignedBill()               // 先指派给 ENGINEER_ID(21)
  await assignEngineer(finance, bill.id, { engineerId: OTHER_ENGINEER.id })   // 改派给另一名工程师

  const asOriginal = await getBillDetail(original, bill.id)
  assert.equal(asOriginal.isMyTurn, false, '改派后原工程师不再是自己这一环')
  assert.equal(asOriginal.permissions.canConfirm, false)
  assert.match(asOriginal.permissions.confirmBlockedReason, /已指派给 赵晓伟/, '给出不可确认的原因')
  const asNew = await getBillDetail(OTHER_ENGINEER, bill.id)
  assert.equal(asNew.isMyTurn, true, '被指派的人才是当前确认人')

  // 原工程师手里的本单待办被清空，并收到「已改派」
  const mine = notifications.filter(n => Number(n.refId) === bill.id && n.userIds.includes(original.id))
  assert.ok(mine.length >= 2, '原工程师应同时有「待确认」和「已改派」两条')
  assert.equal(mine.filter(n => !/已改派/.test(n.title)).every(n => n.read), true, '原工程师的本单待办应被置为已读')
  assert.equal(mine.some(n => /已改派/.test(n.title)), true)

  // 原工程师既不能在待办列表看到，也不能确认
  const todoRaw = listBills(original, new URLSearchParams({ scope: 'todo' }))
  const todoItems = todoRaw.items || todoRaw
  assert.equal(todoItems.some(x => x.id === bill.id), false, '待我处理里不应再有这张单')
  await assert.rejects(() => confirmBill(original, bill.id, {}), err => err.code === 'FORBIDDEN')
})

// ===== 驳回后改金额：成本中心按「新金额」校验，不能被旧金额误拦 =====
test('驳回后改金额：成本中心跟随新金额，旧核算作废，重提按新值走', async () => {
  const bill = await makeAssignedBill()                    // 金额 1500，成本中心 100%
  await confirmBill(bizEngineer, bill.id, {})
  await rejectBill(finance, bill.id, { reason: '金额需重新核对' })
  assert.equal((await getBillDetail(pm, bill.id)).status, 'REJECTED')

  // 供应商改金额（明细与成本中心同步改）——顺序错误时会拿旧金额校验而误拦
  const updated = await updateBill(supplierA, bill.id, {
    items: [{ taskName: '改后-A', unit: '帧', quantity: 1, unitPrice: 2000 }],
    costCenters: [{ name: '端到端项目', amount: 2000 }]
  })
  assert.equal(updated.totalAmount, 2000, '单据合计按新明细重算')
  assert.equal(updated.finance, null, '旧核算作废')
  assert.equal(updated.costCenters[0].amount, 2000)
  assert.equal(updated.costCenters[0].ratio, 100)

  // 成本中心确实填错时，报错引用的必须是「新金额」（驳回状态下仍可改单）
  await assert.rejects(
    () => updateBill(supplierA, bill.id, { costCenters: [{ name: '端到端项目', amount: 100 }] }),
    (err) => err.code === 'COST_CENTER_AMOUNT_INVALID' && /2000/.test(err.message)
  )

  // 重新提交：链条重置，金额为新值
  const after = await resubmitBill(supplierA, bill.id)
  assert.equal(after.status, 'PENDING_BIZ')
  assert.equal(after.totalAmount, 2000)
  assert.equal(after.resubmitCount, 1)
})

// ===== 驳回重提后，链路只认当前轮（上一轮的"已通过"不得残留）=====
test('驳回重提后链路只认当前轮：上一轮的通过不再显示', async () => {
  const bill = await makeAssignedBill()
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, bill.id, {})
  await confirmParty(bill)                       // 统结方提交 + 财务二次确认
  const before = await getBillDetail(pm, bill.id)
  assert.equal(before.stages.find(s => s.key === 'SETTLEMENT').done, true, '本轮统结方已提交')

  // 负责人驳回 → 供应商修正后重新提交（新的一轮）
  await rejectBill(leader, bill.id, { reason: '本期数据重新核对' })
  const after = await resubmitBill(supplierA, bill.id)
  assert.equal(after.status, 'PENDING_BIZ')
  const chain = after.stages
  assert.equal(chain.find(s => s.key === 'SETTLEMENT').done, false, '重提后不应再显示统结方已通过')
  assert.equal(chain.find(s => s.key === 'FINANCE2').done, false, '重提后不应再显示财务二次确认已通过')
  assert.equal(after.confirmedCount, 0, '当前轮已确认数为 0')
  assert.ok(after.confirms.length >= 4, '历史确认记录仍保留，便于追溯')
})

// ===== 加急催办：催当前环节的处理人，10 分钟内不允许重复催 =====
test('加急催办：催当前环节处理人；同一单 10 分钟内不可重复催', async () => {
  const { urgeBill } = await import('../server/services/bills.js')
  const bill = await makeAssignedBill()
  // 停在「待工程师确认」，且已指派给 ENGINEER_ID
  await assignEngineer(finance, bill.id, { engineerId: ENGINEER_ID })

  // 供应商催办：应发给被指派的工程师
  let mark = notifications.length
  const r = await urgeBill(supplierA, bill.id, { note: '本单今天必须确认' })
  assert.equal(r.urgeCount, 1)
  assert.equal(r.lastUrgedAt !== null, true)
  const urged = notifications.slice(mark).filter(n => (n.title || '').includes('加急催办'))
  assert.equal(urged.length, 1, '应产生一条加急催办提醒')
  assert.equal(urged[0].userIds.includes(ENGINEER_ID), true, '催办应发给被指派的工程师')
  assert.match(urged[0].content, /结算单 YS/)
  assert.match(urged[0].content, /本单今天必须确认/)
  assert.ok(!/¥|金额/.test(urged[0].content), '催办文案同样不展示金额')

  // 频控：10 分钟内再催应被拒
  await assert.rejects(
    () => Promise.resolve().then(() => urgeBill(finance, bill.id, {})),
    err => err.code === 'URGE_TOO_FREQUENT'
  )

  // 已通过的单不可催办
  const done = await makeAssignedBill()
  await confirmBill(bizEngineer, done.id, {})
  await calculateBill(finance, done.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, done.id, {})
  await confirmParty(done)
  await confirmBill(leader, done.id, {})
  await confirmBill(perception, done.id, {})
  await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, done.id, {})
  await assert.rejects(
    () => Promise.resolve().then(() => urgeBill(pm, done.id, {})),
    err => err.code === 'BILL_ALREADY_APPROVED'
  )
})

test('驳回与重新提交都有提醒，且只发给本单供应商', async () => {
  const ownerName = supplierA.userName
  const otherSupplierIds = userIdsOfRole(3).filter(id => users.find(u => u.id === id).userName !== ownerName)
  const bill = await makeAssignedBill()
  await confirmBill(bizEngineer, bill.id, {})

  let mark = notifications.length
  await rejectBill(finance, bill.id, { reason: '单价与合同不符' })
  const ownerSupplierIds = userIdsOfRole(3).filter(id => users.find(u => u.id === id).userName === ownerName)
  const rejected = sentTo(mark, ownerSupplierIds)
  assert.equal(rejected.length >= 1, true, '驳回应通知本单所属供应商账号')
  assert.match(rejected[0].title, /驳回/)
  assert.match(rejected[0].content, /单价与合同不符/)
  assert.equal(sentTo(mark, otherSupplierIds).length, 0, '驳回不应通知其他供应商')

  mark = notifications.length
  await resubmitBill(supplierA, bill.id)
  assert.equal(sentTo(mark, userIdsOfRole(13)).length >= 1, true, '重新提交应再次提醒业务工程师')
})

// ===== 财务结算（核算）=====
test('财务核算：扣款与税率算出应付金额，且写回列表与统计', async () => {
  const bill = await makeAssignedBill()
  await confirmBill(bizEngineer, bill.id, {})

  // 仅财务/甲方PM可核算
  await assert.rejects(() => calculateBill(bizEngineer, bill.id, {}), err => err.code === 'FORBIDDEN')
  await assert.rejects(() => calculateBill(supplierA, bill.id, {}), err => err.status === 403)
  // 税率越界
  await assert.rejects(() => calculateBill(finance, bill.id, { taxRate: 120 }), err => err.status === 422)

  // 基础 1500，扣款 100 → 1500-100=1400；税率 6% → 税额 84；应付 1484
  const done = await calculateBill(finance, bill.id, { deduction: 100, taxRate: 6, note: '扣违约金100' })
  assert.equal(done.finance.baseAmount, 1500)
  assert.equal(done.finance.netAmount, 1400)
  assert.equal(done.finance.taxAmount, 84)
  assert.equal(done.finance.payableAmount, 1484)
  assert.equal(done.finance.note, '扣违约金100')
  assert.equal(done.finance.calculatedByName, finance.userName)

  // 列表与统计带上应付金额
  const row = listBills(pm, new URLSearchParams()).items.find(b => b.id === bill.id)
  assert.equal(row.payableAmount, 1484)
  assert.equal(row.finance.deduction, 100)
  const stats = billStats(pm)
  assert.equal(stats.calculatedCount >= 1, true)
  assert.equal(stats.pendingPayableAmount >= 1484, true)
})

test('财务核算：仅「待财务确认」阶段可核算；重提后旧核算作废', async () => {
  const bill = await makeAssignedBill()
  // 尚未流转到财务
  await assert.rejects(() => calculateBill(finance, bill.id, {}), err => err.code === 'BILL_STATE_CONFLICT')

  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 50, taxRate: 0 })
  assert.equal((await getBillDetail(pm, bill.id)).payableAmount, 1450)

  // 驳回 → 重新提交：核算作废（金额可能变化，需财务重算）
  await rejectBill(finance, bill.id, { reason: '金额需重算' })
  const back = await resubmitBill(supplierA, bill.id)
  assert.equal(back.finance, null)
  assert.equal(back.payableAmount, null)
  await assert.rejects(() => confirmBill(finance, bill.id, {}), err => err.code === 'FORBIDDEN')
})

// 项目卡片上的数字必须与「该项目下结算单」口径一致（此前卡片取任务数，结算类项目恒为 0，页面显示对不上）
test('项目维度汇总与项目下的结算单一致：单数/已通过/金额/应付金额', async () => {
  const bill = await makeAssignedBill()
  await confirmBill(bizEngineer, bill.id, {})
  await calculateBill(finance, bill.id, { deduction: 0, taxRate: 0 })
  await confirmBill(finance, bill.id, {})
  await confirmParty(bill, '统结提交')
  await confirmBill(leader, bill.id, {})
  await confirmBill(perception, bill.id, {})
  const done = await confirmBill({ id: OA_ID, roleType: 18, roleTypes: [18], userName: '彭桂苹' }, bill.id, {})
  assert.equal(done.status, 'APPROVED')

  const list = listBills(pm, new URLSearchParams({ projectId: String(PROJECT_ID), pageSize: '100' })).items
  const approvedBills = list.filter(b => b.status === 'APPROVED')
  const row = billStats(pm).projects.find(p => p.projectId === PROJECT_ID)
  assert.ok(row, '统计里应有该项目')
  assert.equal(row.billCount, list.length)
  assert.equal(row.approvedCount, approvedBills.length)
  assert.equal(row.approvedAmount, Number(approvedBills.reduce((s, b) => s + b.totalAmount, 0).toFixed(2)))
  assert.equal(row.payableAmount, Number(approvedBills.reduce((s, b) => s + (b.finance?.payableAmount ?? b.totalAmount), 0).toFixed(2)))
})

// 明细「确认记录」要能看到供应商提交这一环（此前只有工程师之后的环节）
test('确认记录含供应商提交：提交人/单数金额，重提再记一条', async () => {
  const bill = await makeAssignedBill()
  const d1 = await getBillDetail(pm, bill.id)
  const first = d1.confirms.filter(c => c.stageKey === 'SUPPLIER')
  assert.equal(first.length, 1)
  assert.equal(first[0].stageLabel, '供应商提交')
  assert.equal(first[0].userName, supplierA.userName)
  assert.equal(first[0].itemCount, 2)
  assert.equal(first[0].totalAmount, 1500)
  assert.equal(first[0].resubmitCount, 0)

  await confirmBill(bizEngineer, bill.id, {})
  await rejectBill(finance, bill.id, { reason: '批次名称需更正' })
  await resubmitBill(supplierA, bill.id)

  const submits = (await getBillDetail(pm, bill.id)).confirms.filter(c => c.stageKey === 'SUPPLIER')
  assert.equal(submits.length, 2)
  assert.equal(submits[1].stageLabel, '供应商重新提交')
  assert.equal(submits[1].resubmitCount, 1)
  assert.ok(submits[0].at && submits[1].at, '每条都要有提交时间')

  // 再走一轮驳回重提：每次提交各留一条，互不覆盖
  await confirmBill(bizEngineer, bill.id, {})
  await rejectBill(finance, bill.id, { reason: '金额需再核' })
  await resubmitBill(supplierA, bill.id)
  const three = (await getBillDetail(pm, bill.id)).confirms.filter(c => c.stageKey === 'SUPPLIER')
  assert.deepEqual(three.map(c => c.resubmitCount), [0, 1, 2])
  assert.deepEqual(three.map(c => c.stageLabel), ['供应商提交', '供应商重新提交', '供应商重新提交'])

  // 供应商只看得到自己的提交记录
  const asSupplier = await getBillDetail(supplierA, bill.id)
  assert.equal(asSupplier.confirms[0].stageKey, 'SUPPLIER')
})
