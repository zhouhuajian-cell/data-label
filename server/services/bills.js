// 验收结算确认服务
// 流程：供应商上传已验收数据 → 业务工程师确认 → 财务端确认 → 负责人确认 → 感知工程师确认 → 通过
// 约定：status 一律由 deriveStatus(currentStage, rejected) 推导，不提供"任意改 status"的接口。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../lib/http.js'
import { bills, projects, auditLogs, users } from '../repositories/data.js'
import {
  loadBills, saveBill, deleteBillRow, loadItems, replaceItems, loadItemsForBills, migrateFromJsonCollections
} from '../repositories/finance-db.js'
import { nowText, todayText } from '../lib/time.js'
import { MONEY_DECIMALS, roundMoney, roundPercent } from '../lib/money.js'
import { notifyRoles, notifyByRole, createNotification, markRefReadForUsers } from './notifications.js'
import {
  BILL_STAGES, BILL_STATUS, ROLE,
  currentStage, deriveStatus, assertSupplierVisible, assertConfirmable, computeRowAmount, stageCount,
  canOriginate, isSupplierOnly, isMyTurn, sameSupplier
} from '../lib/bill-flow.js'
import { hasRole, hasAnyRole } from '../lib/roles.js'
import { ACCEPTANCE_MAX_ROWS } from './excel.js'
import { compileFormula, validateFormula, DEFAULT_FORMULA, FORMULA_VARS } from '../lib/formula.js'

// 结算金额较供应商提交金额的增幅上限（超过则报警且不可提交）
export const MAX_INCREASE_RATE = 0.035

// 成本中心比例必须合计 100%
const COST_CENTER_TOTAL = 100

// 成本中心：优先按「金额」填（供应商口径）→ 占比自动推算；
// 兼容直接填占比的老口径。金额口径下金额合计必须等于单据金额（防呆）。
function normalizeCostCenters(raw, amount) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ApiError(422, 'VALIDATION_ERROR', '成本中心格式不正确')
  const base = Number(amount) || 0
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
  const list = raw
    .map(x => ({ name: String(x?.name || '').trim(), ratio: num(x?.ratio), amount: num(x?.amount) }))
    .filter(x => x.name || x.ratio !== null || x.amount !== null)
  if (!list.length) return []
  for (const x of list) {
    if (!x.name) throw new ApiError(422, 'VALIDATION_ERROR', '成本中心名称不能为空')
  }

  // 口径一（优先）：填了金额 → 由金额推算占比；最后一条吸收舍入，保证合计正好 100%
  const useAmount = list.every(x => x.ratio === null) && base > 0 && list.some(x => Number(x.amount) > 0)
  if (useAmount) {
    const sumAmount = roundMoney(list.reduce((s, x) => s + (Number(x.amount) || 0), 0))
    if (Math.abs(sumAmount - base) > 0.01) {
      throw new ApiError(422, 'COST_CENTER_AMOUNT_INVALID',
        `成本中心金额合计 ¥${sumAmount} 与单据金额 ¥${base} 不一致（差额 ¥${roundMoney(sumAmount - base)}）`)
    }
    let used = 0
    return list.map((x, i) => {
      if (i === list.length - 1) return { name: x.name, ratio: Number((COST_CENTER_TOTAL - used).toFixed(4)) }
      const ratio = Number(((Number(x.amount) || 0) / base * COST_CENTER_TOTAL).toFixed(4))
      used = Number((used + ratio).toFixed(4))
      return { name: x.name, ratio }
    })
  }

  // 口径二（兼容）：直接填占比
  for (const x of list) {
    if (!Number.isFinite(x.ratio) || x.ratio < 0 || x.ratio > COST_CENTER_TOTAL) {
      throw new ApiError(422, 'VALIDATION_ERROR', `成本中心「${x.name}」的比例需在 0~100 之间`)
    }
  }
  const total = Number(list.reduce((sum, x) => sum + x.ratio, 0).toFixed(2))
  if (total !== COST_CENTER_TOTAL) {
    throw new ApiError(422, 'COST_CENTER_TOTAL_INVALID',
      `成本中心比例合计必须为 100%，当前为 ${total}%（${list.map(x => x.name + ' ' + x.ratio + '%').join('、')}）`)
  }
  return list.map(x => ({ name: x.name, ratio: x.ratio }))
}

// 按占比把金额分摊到各成本中心；最后一个吸收四舍五入差额，保证分摊合计 = 金额
export function allocateCostCenters(costCenters, amount) {
  const list = Array.isArray(costCenters) ? costCenters : []
  const total = Number(amount) || 0
  if (!list.length) return []
  if (total <= 0) return list.map(c => ({ name: c.name, ratio: c.ratio, amount: 0 }))
  let allocated = 0
  return list.map((c, i) => {
    if (i === list.length - 1) return { name: c.name, ratio: c.ratio, amount: roundMoney(total - allocated) }
    const amt = roundMoney(total * c.ratio / 100)
    allocated = roundMoney(allocated + amt)
    return { name: c.name, ratio: c.ratio, amount: amt }
  })
}

// 单据当前用于分摊的金额：已核算则用应付金额，否则用提交金额
function billAllocBase(bill) {
  return bill.finance ? Number(bill.finance.payableAmount) : Number(bill.totalAmount)
}

const FINANCE_CHAIN_ROLES = BILL_STAGES.map(s => s.roleType)
// OA 结算专员(18) 需要查看已通过的结算单去录 OA，但不参与确认节点
const ALL_BILL_ROLES = [ROLE.CLIENT_PM, ROLE.VENDOR_TL, ROLE.OA_SETTLEMENT, ...FINANCE_CHAIN_ROLES]

const round2 = (n) => roundPercent(n)

// ===== 附件留存：产出明细表等原始文件 =====
// 存到 uploads/bills/，下载复用通用路由 GET /api/files/download/<storedName>
const billsUploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/bills')
const ATTACH_MAX_BYTES = 30 * 1024 * 1024
// 附件类型：Excel/CSV、Word、PDF 以及压缩包与图片
const ATTACH_EXTS = ['xlsx', 'xls', 'csv', 'txt', 'doc', 'docx', 'pdf', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg']

function ensureBillsUploadDir() {
  if (!fs.existsSync(billsUploadDir)) fs.mkdirSync(billsUploadDir, { recursive: true })
}

// storedName 形如 bills/<ts>_<rand>.<ext>；下载时作为相对 uploads/ 的路径
// 附件引用校验：由上面的白名单生成，新增附件类型时只改 ATTACH_EXTS 一处
const STORED_NAME_RE = new RegExp(`^bills/[A-Za-z0-9_-]+\.(${ATTACH_EXTS.join('|')})$`, 'i')

export function saveBillAttachment(user, body = {}) {
  requireBillRoles(user)
  const data = String(body.fileData || '')
  if (!data) throw new ApiError(422, 'VALIDATION_ERROR', '请上传文件')
  const originalName = String(body.fileName || 'attachment').trim()
  const ext = (originalName.split('.').pop() || '').toLowerCase()
  if (!ATTACH_EXTS.includes(ext)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `不支持的文件类型：.${ext}，支持 ${ATTACH_EXTS.join('/')}`)
  }
  const buffer = Buffer.from(data, 'base64')
  if (!buffer.length) throw new ApiError(422, 'VALIDATION_ERROR', '文件内容为空')
  if (buffer.length > ATTACH_MAX_BYTES) {
    throw new ApiError(422, 'VALIDATION_ERROR', `文件过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），上限 30MB`)
  }
  ensureBillsUploadDir()
  const storedName = `bills/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`
  fs.writeFileSync(path.join(billsUploadDir, storedName.replace('bills/', '')), buffer)
  return {
    storedName,
    originalName,
    size: buffer.length,
    uploadedAt: nowText(),
    uploadedBy: user.userName
  }
}

// 校验并规范化附件引用（只接受本服务生成的名字，防目录穿越）
function normalizeAttachments(raw) {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) throw new ApiError(422, 'VALIDATION_ERROR', '附件格式不正确')
  return raw.slice(0, 20).map((a) => {
    const storedName = String(a?.storedName || '').trim()
    if (!STORED_NAME_RE.test(storedName)) {
      throw new ApiError(422, 'VALIDATION_ERROR', '附件引用不合法，请通过上传接口获取')
    }
    return {
      storedName,
      originalName: String(a?.originalName || storedName.split('/').pop()).trim(),
      size: Number(a?.size) || 0,
      uploadedAt: String(a?.uploadedAt || nowText()),
      uploadedBy: String(a?.uploadedBy || '')
    }
  })
}

function nextId(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}


function makeBillNo() {
  const day = todayText().replace(/-/g, '')
  const prefix = 'YS' + day
  const used = bills.filter(b => String(b.billNo || '').startsWith(prefix)).length
  return prefix + String(used + 1).padStart(3, '0')
}

function requireBillRoles(user) {
  if (!hasAnyRole(user, ALL_BILL_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', '当前角色无权访问验收结算单')
  }
}

function findBillOr404(id) {
  const bill = bills.find(b => b.id === id)
  if (!bill) throw new ApiError(404, 'BILL_NOT_FOUND', '结算单不存在')
  return bill
}

// 明细行规范化：任务名必填，数量/单价非负
//  - 未指定公式 → 沿用"数量×单价，单价缺失回退表格金额"的默认口径
//  - 指定公式   → 按公式逐行求值（服务端为唯一权威，前端只做预览）
function normalizeItems(rawItems, formula, billLevel = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请至少提供一条验收数据明细')
  }
  if (rawItems.length > ACCEPTANCE_MAX_ROWS) {
    throw new ApiError(422, 'VALIDATION_ERROR', `单张结算单最多 ${ACCEPTANCE_MAX_ROWS} 条明细`)
  }
  const compiled = formula ? compileFormula(formula) : null
  const details = []
  rawItems.forEach((raw, i) => {
    const taskName = String(raw?.taskName || '').trim()
    if (!taskName) throw new ApiError(422, 'VALIDATION_ERROR', `第 ${i + 1} 行缺少项目`)
    const quantity = Number(raw.quantity) || 0
    const unitPrice = Number(raw.unitPrice) || 0
    if (quantity < 0 || unitPrice < 0) {
      throw new ApiError(422, 'VALIDATION_ERROR', `第 ${i + 1} 行的数量/单价不能为负数`)
    }
    const declared = raw.amount === undefined || raw.amount === null || raw.amount === '' ? 0 : Number(raw.amount)
    let amount
    try {
      amount = compiled
        ? compiled.evaluate({ quantity, unitPrice, amount: declared, 系数: raw.系数 }, billLevel)
        : computeRowAmount({ quantity, unitPrice, amount: declared })
    } catch (e) {
      if (e.code === 'FORMULA_INVALID') {
        throw new ApiError(422, 'FORMULA_INVALID', `第 ${i + 1} 行公式结算失败：${e.message}`)
      }
      throw e
    }
    details.push({
      seq: i + 1,
      taskName,
      dataType: String(raw.dataType || '').trim(),
      unit: String(raw.unit || '').trim(),
      acceptDate: String(raw.acceptDate || '').trim(),
      quantity,
      unitPrice,
      amount,
      dataPath: String(raw.dataPath || '').trim(),
      remark: String(raw.remark || '').trim()
    })
  })
  return details
}

function sumTotals(details) {
  return {
    itemCount: details.length,
    totalQuantity: roundMoney(details.reduce((s, d) => s + d.quantity, 0)),
    totalAmount: roundMoney(details.reduce((s, d) => s + d.amount, 0))
  }
}

// 明细写入关系表（覆盖式：先删该单旧明细再插入）
async function writeItems(billId, details) {
  await replaceItems(billId, details)
}

function audit(action, user, bill, extra = {}) {
  auditLogs.push({ action, actorId: user.id, actorName: user.userName, billNo: bill.billNo, billId: bill.id, at: nowText(), ...extra })
}

// 统一的单据摘要，保证各环节飞书/站内消息口径一致
// 提醒/待办里的单据信息：只展示项目信息，不展示金额
function billSummary(bill) {
  const parts = [`结算单 ${bill.billNo}`]
  if (bill.projectName) parts.push(`项目：${bill.projectName}`)
  if (bill.batchName) parts.push(`批次：${bill.batchName}`)
  if (bill.supplierName) parts.push(`供应商：${bill.supplierName}`)
  return parts.join(' · ')
}

// ===== 信息传递统一口径：角色-姓名（如「业务工程师-彭晓蕾」「财务-张海霞」「统结方-柏川」）=====
const USER_ROLE_NAMES = [
  [ROLE.CLIENT_PM, '管理员'], [ROLE.FINANCE, '财务'], [ROLE.LEADER, '负责人'],
  [ROLE.PERCEPTION, '算法'], [ROLE.BIZ_ENGINEER, '业务工程师'],
  [ROLE.SETTLEMENT, '统结方'], [ROLE.OA_SETTLEMENT, 'OA结算专员'], [ROLE.VENDOR_TL, '供应商']
]
const roleNameOf = (stage) => (stage && (stage.roleName || stage.label)) || ''
// 某人的「角色-姓名」：按最贴近结算链的角色取
function actorText(user) {
  const name = user?.userName || ''
  const hit = USER_ROLE_NAMES.find(([role]) => hasRole(user, role))
  return hit ? `${hit[1]}-${name}` : name
}
// 当前环节的处理人姓名：第一环节用被指派的工程师，其余取持有该环节角色的账号
function handlerNamesOf(bill, stage) {
  if (!stage) return []
  if (stage.key === 'BIZ') return bill.assigneeName ? [bill.assigneeName] : []
  return users.filter(u => !u.disabled && hasRole(u, stage.roleType)).map(u => u.userName)
}
function handlerText(bill, stage) {
  if (!stage) return ''
  const names = handlerNamesOf(bill, stage)
  return names.length ? `${roleNameOf(stage)}-${names.join('、')}` : roleNameOf(stage)
}
// 当前环节「该谁处理」的姓名（列表与步骤条用；待指派工程师时显示财务）
function currentHandlerOf(bill) {
  // 已驳回：整单退回供应商修正后重新提交，不显示原环节的处理人
  if (bill.status === 'REJECTED') return '待供应商修正后重新提交'
  const stage = currentStage(bill)
  if (!stage) return ''
  if (stage.key === 'BIZ' && !bill.assigneeId) {
    return users.filter(u => !u.disabled && hasRole(u, ROLE.FINANCE)).map(u => u.userName).join('、')
  }
  return handlerNamesOf(bill, stage).join('、')
}

// 某角色的所有账号姓名（如 财务 / OA结算专员 / 统结方）
function roleHoldersText(roleLabel, roleType) {
  const names = users.filter(u => !u.disabled && hasRole(u, roleType)).map(u => u.userName)
  return names.length ? `${roleLabel}-${names.join('、')}` : roleLabel
}

// 环节提醒：推送给「当前待确认节点」的角色（多角色账号命中即推送）
function notifyNextStage(bill) {
  const stage = currentStage(bill)
  if (!stage) return
  // 第一环节尚未指派工程师时：提醒财务（张海霞）先指派，而不是直接推给全体工程师
  if (stage.key === 'BIZ' && !bill.assigneeId) {
    notifyAssignNeeded(bill)
    return
  }
  notifyRoles([stage.roleType], 'finance', `【待${stage.short}确认】${handlerText(bill, stage)}`,
    `${billSummary(bill)}\n当前环节：${handlerText(bill, stage)}（请登录平台处理）`, 'bill', bill.id)
}

// 提醒财务指派工程师（供应商提交后的第一个动作）
function notifyAssignNeeded(bill) {
  notifyRoles([ROLE.FINANCE], 'todo', `【待办】指派工程师确认数据：${bill.batchName}`,
    `${billSummary(bill)}\n供应商-${bill.supplierName} 已提交，请 ${roleHoldersText('财务', ROLE.FINANCE)} 指定工程师对该项目做数据确认`, 'bill', bill.id)
}

// 指派工程师：仅财务（张海霞）；指派后只通知被指派的那个工程师
// 链路新增/调整节点后，按 confirms 重新定位历史单据的 currentStage（幂等，启动时跑一次）
export async function repairBillStages() {
  let fixed = 0
  for (const bill of bills) {
    // 已完成的单据按历史状态保留（新增末环节不追溯）
    // 已完成的单据按历史状态保留（新增末环节不追溯），并把环节序号对齐到链尾
    if (bill.status === 'APPROVED') {
      if (bill.currentStage !== BILL_STAGES.length) { bill.currentStage = BILL_STAGES.length; await saveBill(bill); fixed++ }
      continue
    }
    const done = new Set((bill.confirms || []).map(c => c.stageKey))
    let idx = 0
    while (idx < BILL_STAGES.length && done.has(BILL_STAGES[idx].key)) idx++
    const status = deriveStatus({ currentStage: idx, rejected: bill.rejected })
    if (bill.currentStage !== idx || bill.status !== status) {
      bill.currentStage = idx
      bill.status = status
      bill.updatedAt = nowText()
      await saveBill(bill)
      fixed++
    }
  }
  return fixed
}

// 加急催办：给「当前环节的处理人」发加急提醒（站内 + 飞书同一文案）
// 频控：同一单据 10 分钟内只允许催办一次，避免刷屏
const URGE_COOLDOWN_MS = 10 * 60 * 1000

export async function urgeBill(user, id, body = {}) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  assertSupplierVisible(user, bill)
  if (bill.status === 'APPROVED') throw new ApiError(409, 'BILL_ALREADY_APPROVED', '该单据已全部确认通过，无需催办')
  if (bill.status === 'REJECTED') throw new ApiError(409, 'BILL_ALREADY_REJECTED', '该单据处于驳回状态，请先重新提交')

  const urges = Array.isArray(bill.urges) ? bill.urges : []
  const last = urges[urges.length - 1]
  if (last && Date.now() - new Date(String(last.at).replace(/-/g, '/')).getTime() < URGE_COOLDOWN_MS) {
    throw new ApiError(429, 'URGE_TOO_FREQUENT', '刚催办过（10 分钟内只能催办一次），请稍后再试')
  }

  // 目标：停在哪一环就催哪一环；第一环节还没指派工程师时催财务去指派
  const stage = currentStage(bill)
  let targetIds = []
  let targetLabel = ''
  if (bill.status === 'PENDING_BIZ' && !bill.assigneeId) {
    targetIds = users.filter(u => !u.disabled && hasRole(u, ROLE.FINANCE)).map(u => u.id)
    targetLabel = `${roleHoldersText('财务', ROLE.FINANCE)}（待指派工程师）`
  } else if (bill.status === 'PENDING_BIZ' && bill.assigneeId) {
    targetIds = [bill.assigneeId]
    targetLabel = bill.assigneeName ? `业务工程师-${bill.assigneeName}` : '业务工程师'
  } else {
    targetIds = users.filter(u => !u.disabled && hasRole(u, stage.roleType)).map(u => u.id)
    targetLabel = handlerText(bill, stage) || '当前环节'
  }
  if (!targetIds.length) throw new ApiError(422, 'NO_TARGET', '当前环节没有可催办的处理人，请检查账号角色配置')

  const note = String(body.note || '').trim().slice(0, 100)
  const record = { by: user.userName, byId: user.id, at: nowText(), stage: targetLabel, note }
  bill.urges = [...urges, record]
  bill.updatedAt = nowText()
  await saveBill(bill)

  createNotification(targetIds, 'todo', `【加急催办】${bill.batchName}`,
    `${billSummary(bill)}\n${actorText(user)} 加急催办：当前环节「${targetLabel}」，请尽快处理` + (note ? `\n催办说明：${note}` : ''),
    'bill', bill.id)
  audit('finance.bill.urge', user, bill, { target: targetLabel, targetCount: targetIds.length, note })
  return getBillDetail(user, bill.id)
}

// 统结方重新提交：单据停在「统结方提交」或「财务二次确认」时，由统结方改正后重新提交
// （避免金额录错只能靠整单驳回来解决）
export async function resubmitSettlement(user, id, body = {}) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  if (!hasRole(user, ROLE.SETTLEMENT)) throw new ApiError(403, 'FORBIDDEN', '仅统一结算方可重新提交统结数据')
  if (!['PENDING_SETTLEMENT', 'PENDING_FINANCE2'].includes(bill.status)) {
    throw new ApiError(409, 'BILL_STATE_CONFLICT', `当前状态（${BILL_STATUS[bill.status] || bill.status}）不可重新提交统结数据`)
  }
  const items = Array.isArray(body.items) ? body.items : []
  const submittedTotal = Number(body.submittedTotal) || 0
  if (!items.length) {
    throw new ApiError(422, 'SETTLEMENT_REQUIRED', '请导入统结明细（Excel/CSV 或粘贴）后再提交')
  }
  if (!(normalizeAttachments(body.attachments) || []).length) {
    throw new ApiError(422, 'ATTACHMENT_REQUIRED', '请上传「附件（明细数据）」后再提交')
  }
  const { base, supplierCount, billCount } = supplierBaseAmount(bill)
  let details = null
  let total = roundMoney(submittedTotal)
  if (items.length) {
    details = normalizeItems(items, bill.formula, { 系数: bill.coefficient })
    total = sumTotals(details).totalAmount
  }
  const settlement = {
    source: items.length ? 'import' : 'manual',
    ...(details ? { items: details, itemCount: details.length, totalQuantity: sumTotals(details).totalQuantity } : {}),
    submittedTotal: total,
    supplierTotal: base,
    supplierCount,
    billCount,
    difference: roundMoney(total - base),
    increasePercent: base > 0 ? roundPercent((total - base) / base * 100) : 0,
    limitPercent: roundPercent(MAX_INCREASE_RATE * 100),
    attachments: normalizeAttachments(body.attachments) || [],
    costCenters: normalizeCostCenters(body.costCenters, total),
    period: bill.period || '',
    submittedBy: actorText(user),
    resubmittedAt: nowText()
  }
  const last = [...bill.confirms].reverse().find(c => c.stageKey === 'SETTLEMENT')
  if (last) last.settlement = settlement
  else {
    bill.confirms.push({
      stage: BILL_STAGES.findIndex(s => s.key === 'SETTLEMENT'), stageKey: 'SETTLEMENT', stageLabel: '统结方提交',
      roleType: ROLE.SETTLEMENT, userId: user.id, userName: user.userName,
      action: 'SUBMIT', comment: '统结方提交统结数据', at: nowText(), settlement
    })
  }
  bill.comparison = {
    base, submitted: total, difference: roundMoney(total - base),
    ratePercent: settlement.increasePercent, limitPercent: settlement.limitPercent,
    exceeded: base > 0 && settlement.increasePercent > settlement.limitPercent,
    supplierCount, projectName: bill.projectName || '', comparedAt: nowText(), comparedBy: user.userName
  }
  bill.updatedAt = nowText()
  await saveBill(bill)
  audit('finance.bill.settlement.resubmit', user, bill, { submittedTotal: total, base })
  return getBillDetail(user, bill.id)
}

export async function assignEngineer(user, id, body = {}) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  assertSupplierVisible(user, bill)
  if (!hasRole(user, ROLE.FINANCE)) {
    throw new ApiError(403, 'FORBIDDEN', '仅财务可指派工程师')
  }
  if (bill.status !== 'PENDING_BIZ') {
    throw new ApiError(409, 'BILL_STATE_CONFLICT', `仅「待指派/待工程师确认」的单据可指派（当前：${BILL_STATUS[bill.status] || bill.status}）`)
  }
  if ((bill.confirms || []).length > 0) {
    throw new ApiError(409, 'BILL_STATE_CONFLICT', '该单据已开始确认，不可改派')
  }
  const engineerId = Number(body.engineerId || 0)
  const engineer = users.find(u => u.id === engineerId && !u.disabled && hasRole(u, ROLE.BIZ_ENGINEER))
  if (!engineer) throw new ApiError(422, 'VALIDATION_ERROR', '请选择有效的工程师（需持「工程师」角色）')

  const prevAssigneeId = bill.assigneeId || null
  bill.assigneeId = engineer.id
  bill.assigneeName = engineer.userName
  bill.assignedAt = nowText()
  bill.assignedBy = user.userName
  bill.updatedAt = nowText()
  await saveBill(bill)
  audit('finance.bill.assign', user, bill, { assigneeId: engineer.id, assigneeName: engineer.userName })

  // 改派：把原工程师手里的本单待办标记为已读并明确告知，避免两个人同时看到同一张单
  if (prevAssigneeId && prevAssigneeId !== engineer.id) {
    markRefReadForUsers('bill', bill.id, [prevAssigneeId])
    createNotification([prevAssigneeId], 'todo', `【已改派】${bill.batchName}`,
      `${billSummary(bill)}\n本单已由 ${actorText(user)} 改派给 业务工程师-${engineer.userName}，你无需再确认`, 'bill', bill.id)
  }

  // 只通知被指派的工程师本人
  createNotification([engineer.id], 'todo', `【待工程师确认】${bill.batchName}`,
    `${billSummary(bill)}\n由 ${actorText(user)} 指派给 业务工程师-${engineer.userName} 做本单数据确认，请核对数据明细与成本中心比例后确认`, 'bill', bill.id)
  return getBillDetail(user, bill.id)
}

// 可指派的工程师名单（持「工程师」角色的启用账号）
export function listEngineers(user) {
  requireBillRoles(user)
  return users.filter(u => !u.disabled && hasRole(u, ROLE.BIZ_ENGINEER))
    .map(u => ({ id: u.id, userName: u.userName }))
}

// 供应商姓名清单（口径=姓名）：供应商账号显示名 + 单据里已用过的姓名，去重后排序
export function listSupplierNames(user) {
  requireBillRoles(user)
  const names = new Set()
  users.filter(u => !u.disabled && hasRole(u, ROLE.VENDOR_TL))
    .forEach(u => { if (String(u.userName || '').trim()) names.add(String(u.userName).trim()) })
  bills.forEach(b => { if (String(b.supplierName || '').trim()) names.add(String(b.supplierName).trim()) })
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

// 环节通过：回执给单据提交人（按用户 id 精确推送，而非按角色）
function notifySubmitter(bill, stage, confirmerName, nextStage) {
  if (!bill.createdBy) return
  const tail = nextStage ? `已流转至 ${handlerText(bill, nextStage)}` : '确认流程已全部通过'
  createNotification([bill.createdBy], 'finance', `【已通过${stage.label}】${confirmerName}`,
    `${billSummary(bill)}\n${roleNameOf(stage)}-${confirmerName} 已确认通过，${tail}`, 'bill', bill.id)
}

// 只通知该单据所属供应商（不是全部供应商）
function notifySupplier(bill, title, content) {
  notifyByRole(bill.supplierName, [ROLE.VENDOR_TL], 'finance', title,
    `${billSummary(bill)}\n${content}`, 'bill', bill.id)
}

// 确认链进度（列表与详情共用）：每个节点标记 已确认/当前待确认/被驳回
// 当前轮的确认记录。
// 新记录带 round（重提时会把上一轮的历史记录显式标记为旧轮次）→ 精确按轮次过滤；
// 历史记录没有 round 字段，无法回溯归属，按「算当前轮」处理（否则老单据重提后链路会变空）。
function confirmsOfCurrentRound(bill) {
  const round = bill.resubmitCount || 0
  return (bill.confirms || []).filter(c => typeof c.round !== 'number' || c.round === round)
}

function buildChain(bill) {
  const rejected = bill.status === 'REJECTED'
  const lastRejectStage = rejected
    ? ((bill.rejections || [])[bill.rejections.length - 1] || {}).stage ?? null
    : null
  const currentConfirms = confirmsOfCurrentRound(bill)
  return BILL_STAGES.map((s, i) => ({
    key: s.key,
    label: s.label,
    short: s.short,
    // 只统计「当前轮」的确认记录：驳回重提后上一轮的通过不再算数
    done: currentConfirms.some(c => c.stageKey === s.key),
    active: !rejected && bill.status !== 'APPROVED' && bill.currentStage === i,
    error: rejected && lastRejectStage === i
  }))
}

// 列表项（不含明细行，避免列表过重）
function toListItem(user, bill) {
  const stage = currentStage(bill)
  const confirms = bill.confirms || []
  const lastReject = (bill.rejections || [])[bill.rejections.length - 1] || null
  return {
    chain: buildChain(bill),
    confirmedCount: confirmsOfCurrentRound(bill).length,
    stageCount: stageCount(),
    // 财务核算（财务结算模块用）
    finance: bill.finance || null,
    baseAmount: bill.totalAmount,
    payableAmount: bill.finance ? bill.finance.payableAmount : null,
    rejectStageLabel: lastReject ? lastReject.stageLabel : '',
    rejectByName: lastReject ? lastReject.userName : '',
    id: bill.id, billNo: bill.billNo, batchName: bill.batchName, period: bill.period,
    projectId: bill.projectId || null, projectName: bill.projectName || '',
    supplierName: bill.supplierName,
    itemCount: bill.itemCount, totalQuantity: bill.totalQuantity, totalAmount: bill.totalAmount,
    status: bill.status,
    // 第一环节未指派工程师时，界面上显示为「待指派工程师」（由财务指派）
    statusLabel: (bill.status === 'PENDING_BIZ' && !bill.assigneeId)
      ? '待指派工程师'
      : (BILL_STATUS[bill.status] || bill.status),
    assigneeId: bill.assigneeId || null,
    assigneeName: bill.assigneeName || '',
    assignedBy: bill.assignedBy || '',
    assignedAt: bill.assignedAt || null,
    currentStage: bill.currentStage, stageLabel: stage ? stage.label : '',
    isMyTurn: isMyTurn(user, bill),
    resubmitCount: bill.resubmitCount,
    rejectReason: bill.rejectReason || '',
    sourceFileName: bill.sourceFileName || '', importMode: bill.importMode || 'manual',
    formula: bill.formula || DEFAULT_FORMULA,
    coefficient: bill.coefficient === undefined ? 1 : bill.coefficient,
    comparison: bill.comparison || null,
    urges: bill.urges || [],
    currentHandler: currentHandlerOf(bill),
    urgeCount: (bill.urges || []).length,
    lastUrgedAt: (bill.urges || []).length ? bill.urges[bill.urges.length - 1].at : null,
    costCenters: bill.costCenters || [],
    attachments: bill.attachments || [],
    remark: bill.remark,
    createdByName: bill.createdByName, createdAt: bill.createdAt, updatedAt: bill.updatedAt,
    approvedAt: bill.approvedAt || null,
    confirmCount: confirmsOfCurrentRound(bill).length
  }
}

// 列表过滤（分页与导出共用同一套条件与数据范围）
function filterBills(user, query) {
  requireBillRoles(user)
  let list = bills.slice()

  // 数据范围：供应商仅本供应商；其余角色（甲方PM + 各级确认人）可见全部
  // 统一结算方按供应商口径隔离，但需要看到"停在统结方节点、等他提交总金额"的单据（他的待办队列）
  if (isSupplierOnly(user)) {
    const asSettlementParty = hasRole(user, ROLE.SETTLEMENT)
    list = list.filter(b =>
      sameSupplier(b, user) ||
      (asSettlementParty && b.status === 'PENDING_SETTLEMENT')
    )
  }

  const status = String(query.get('status') || '').trim()
  if (status && status !== 'all') {
    if (status === 'PENDING') list = list.filter(b => b.status.startsWith('PENDING_'))
    else if (status.includes(',')) {
      const set = status.split(',').map(x => x.trim()).filter(Boolean)
      list = list.filter(b => set.includes(b.status))
    } else list = list.filter(b => b.status === status)
  }

  const scope = String(query.get('scope') || '').trim()
  if (scope === 'todo') {
    // 用 isMyTurn：第一环节按被指派的工程师算，避免改派后两个工程师都看到同一张单
    list = list.filter(b => isMyTurn(user, b))
  } else if (scope === 'done') {
    list = list.filter(b => (b.confirms || []).some(c => c.userId === user.id))
  }

  const supplierName = String(query.get('supplierName') || '').trim()
  if (supplierName) list = list.filter(b => String(b.supplierName || '') === supplierName)

  const projectId = Number(query.get('projectId') || 0)
  if (projectId) list = list.filter(b => b.projectId === projectId)

  const keyword = String(query.get('keyword') || '').trim().toLowerCase()
  if (keyword) {
    list = list.filter(b =>
      String(b.billNo).toLowerCase().includes(keyword) ||
      String(b.batchName).toLowerCase().includes(keyword) ||
      String(b.projectName || '').toLowerCase().includes(keyword) ||
      String(b.supplierName).toLowerCase().includes(keyword))
  }

  const dateFrom = String(query.get('dateFrom') || '').trim()
  if (dateFrom) list = list.filter(b => String(b.createdAt || '') >= dateFrom)
  const dateTo = String(query.get('dateTo') || '').trim()
  if (dateTo) list = list.filter(b => String(b.createdAt || '') <= dateTo + ' 23:59:59')

  return list.sort((a, b) => b.id - a.id)
}

export function listBills(user, query) {
  const list = filterBills(user, query)
  const total = list.length
  const page = Math.max(Number(query.get('page') || 1), 1)
  const pageSize = Math.min(Math.max(Number(query.get('pageSize') || 20), 1), 100)
  const start = (page - 1) * pageSize
  return { items: list.slice(start, start + pageSize).map(b => toListItem(user, b)), total, page, pageSize }
}

export async function getBillDetail(user, id) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  // 统一结算方按供应商口径隔离，但它需要处理"停在统结方节点"的单据（提交本周期总金额）
  const isMyNode = hasRole(user, ROLE.SETTLEMENT) && (
    bill.status === 'PENDING_SETTLEMENT' ||
    (bill.confirms || []).some(c => c.stageKey === 'SETTLEMENT')  // 他已在该单上提交过统结金额
  )
  if (!isMyNode) assertSupplierVisible(user, bill)
  const items = await loadItems(bill.id)
  const stage = currentStage(bill)
  const isOwnerSupplier = hasRole(user, ROLE.VENDOR_TL) && sameSupplier(bill, user)
  return {
    ...toListItem(user, bill),
    sourceFileName: bill.sourceFileName || '',
    items,
    confirms: bill.confirms || [],
    rejections: bill.rejections || [],
    stages: BILL_STAGES.map(s => {
      const rec = confirmsOfCurrentRound(bill).filter(c => c.stageKey === s.key).pop()
      const isActive = !!stage && stage.key === s.key
      // who：已确认 → 确认人姓名；当前环节 → 该处理的人；未到 → 空
      const who = rec ? rec.userName : (isActive ? currentHandlerOf(bill) : '')
      return { key: s.key, label: s.label, roleType: s.roleType, done: !!rec, active: isActive, who }
    }),
    increaseCheck: increaseCheck(bill),
    // 统结方节点/财务二次确认用：同项目「供应商确认金额合计」（不含统结方自己的单）
    supplierConfirmedTotal: (() => {
      const b = supplierBaseAmount(bill)
      return { supplierTotal: b.base, supplierCount: b.supplierCount, billCount: b.billCount, suppliers: b.suppliers }
    })(),
    permissions: {
      canConfirm: isMyTurn(user, bill),
      canReject: isMyTurn(user, bill),
      // 有该环节角色、但不是当前确认人时给出原因（例如已改派给别的工程师）
      confirmBlockedReason: (() => {
        if (!stage || !hasRole(user, stage.roleType) || isMyTurn(user, bill)) return ''
        if (stage.key === 'BIZ') {
          return bill.assigneeId
            ? `本单已指派给 ${bill.assigneeName || '其他工程师'}，由 TA 确认`
            : '本单尚未指派工程师，等待财务指派'
        }
        return ''
      })(),
      canEdit: isOwnerSupplier && canEdit(bill),
      canDelete: hasRole(user, ROLE.CLIENT_PM) || (canEdit(bill) && isOwnerSupplier),
      canResubmit: isOwnerSupplier && bill.status === 'REJECTED'
    }
  }
}

function canEdit(bill) {
  const noConfirmYet = (bill.confirms || []).length === 0
  return bill.status === 'REJECTED' || (bill.status === 'PENDING_BIZ' && noConfirmYet)
}

// 供应商身份以「姓名」为准：供应商账号取自身显示名，甲方PM 代建单时显式指定姓名
function resolveSupplierName(user, body) {
  const requested = String(body.supplierName || '').trim()
  if (requested) return requested
  if (hasRole(user, ROLE.VENDOR_TL) && user.userName) return String(user.userName).trim()
  throw new ApiError(422, 'VALIDATION_ERROR', '请填写供应商（以姓名为准）')
}

// 以项目为导向结算：每张结算确认单必须归属一个项目
function resolveProject(body) {
  const projectId = Number(body.projectId || 0)
  if (!projectId) throw new ApiError(422, 'VALIDATION_ERROR', '请选择结算所属项目')
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(422, 'VALIDATION_ERROR', '项目不存在')
  return { projectId: project.id, projectName: project.name }
}

export async function createBill(user, body) {
  requireBillRoles(user)
  if (!canOriginate(user)) {
    throw new ApiError(403, 'FORBIDDEN', '仅供应商或管理员可创建结算单')
  }
  const batchName = String(body.batchName || '').trim()
  if (!batchName) throw new ApiError(422, 'VALIDATION_ERROR', '请填写批次名称')
  // 结算周期必填：统结对比按「同项目 + 同周期」汇总，周期为空会误把不同批次的单累积
  if (!String(body.period || '').trim()) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请填写结算周期（统结对比按「同项目+同周期」汇总，必填）')
  }
  const supplierName = resolveSupplierName(user, body)
  const project = resolveProject(body)
  const formula = validateFormula(body.formula)
  const coefficient = body.coefficient === undefined || body.coefficient === '' ? 1 : Number(body.coefficient)
  if (!Number.isFinite(coefficient) || coefficient < 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '结算系数必须是大于等于 0 的数字')
  }
  const attachments = normalizeAttachments(body.attachments) || []
  // 防呆：明细数据附件必须上传（与界面同一口径，防止绕过界面提交）
  if (!attachments.length) {
    throw new ApiError(422, 'ATTACHMENT_REQUIRED', '请先上传「附件（明细数据）」，未上传不允许提交')
  }
  const details = normalizeItems(body.items, formula, { 系数: coefficient })
  const totals = sumTotals(details)
  // 成本中心：按金额填时用单据总金额校验（金额合计必须等于总金额）
  const costCenters = normalizeCostCenters(body.costCenters, totals.totalAmount)
  if (!costCenters.length) {
    throw new ApiError(422, 'COST_CENTER_REQUIRED', '请填写成本中心金额（合计必须等于单据总金额）')
  }

  const bill = {
    id: nextId(bills),
    billNo: makeBillNo(),
    batchName,
    period: String(body.period || '').trim(),
    ...project,
    supplierId: null,
    supplierName,
    formula,
    coefficient,
    costCenters: allocateCostCenters(costCenters, totals.totalAmount),
    attachments,
    sourceFileName: String(body.sourceFileName || '').trim(),
    importMode: ['excel', 'paste', 'manual'].includes(body.importMode) ? body.importMode : 'manual',
    remark: String(body.remark || '').trim(),
    currentStage: 0,
    rejected: false,
    status: deriveStatus({ currentStage: 0, rejected: false }),
    rejectReason: '',
    resubmitCount: 0,
    confirms: [],
    rejections: [],
    ...totals,
    createdBy: user.id,
    createdByName: user.userName,
    createdAt: nowText(),
    updatedAt: nowText(),
    approvedAt: null
  }
  bills.push(bill)
  await saveBill(bill)
  await writeItems(bill.id, details)
  audit('finance.bill.create', user, bill, { amount: bill.totalAmount, itemCount: bill.itemCount })

  // 统一结算方（柏川）上传的数据：自动与同项目其他供应商确认金额对比，结果给财务查看
  if (hasRole(user, ROLE.SETTLEMENT)) {
    bill.comparison = compareWithProject(bill, user)
    await saveBill(bill)
    const cm = bill.comparison
    const lines = [
      billSummary(bill),
      `对比口径：同项目「其他供应商确认金额合计」`,
      `其他供应商合计：¥${cm.base}（${cm.supplierCount} 家）`,
      `统结方-${bill.supplierName} 本次提交：¥${cm.submitted}`,
      `差异：¥${cm.difference}｜增幅：${cm.ratePercent}%（上限 ${cm.limitPercent}%）`,
      cm.exceeded ? '⚠ 增幅超上限，请注意核查' : '增幅在上限内'
    ]
    notifyRoles([ROLE.FINANCE, ROLE.CLIENT_PM], cm.exceeded ? 'finance' : 'todo',
      `${cm.exceeded ? '【增幅超限·待核查】' : '【待查看】'}统结方提交金额对比：${bill.batchName}`,
      lines.join('\n'), 'bill', bill.id)
    audit('finance.bill.compare', user, bill, cm)
  }

  notifyNextStage(bill)
  return getBillDetail(user, bill.id)
}

export async function updateBill(user, id, body) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  assertSupplierVisible(user, bill)
  const isOwnerSupplier = hasRole(user, ROLE.VENDOR_TL) && sameSupplier(bill, user)
  if (!isOwnerSupplier) throw new ApiError(403, 'FORBIDDEN', '仅该结算单的供应商可修改')
  if (!canEdit(bill)) throw new ApiError(409, 'BILL_STATE_CONFLICT', '该结算单已进入确认流程，不可修改')

  if (body.batchName !== undefined) {
    const batchName = String(body.batchName).trim()
    if (!batchName) throw new ApiError(422, 'VALIDATION_ERROR', '请填写批次名称')
    bill.batchName = batchName
  }
  if (body.projectId !== undefined) Object.assign(bill, resolveProject(body))
  if (body.period !== undefined) bill.period = String(body.period).trim()
  if (body.remark !== undefined) bill.remark = String(body.remark).trim()
  if (body.sourceFileName !== undefined) bill.sourceFileName = String(body.sourceFileName).trim()
  if (body.attachments !== undefined) bill.attachments = normalizeAttachments(body.attachments) || []
  if (body.formula !== undefined) bill.formula = validateFormula(body.formula)
  if (body.coefficient !== undefined) {
    const c = Number(body.coefficient)
    if (!Number.isFinite(c) || c < 0) throw new ApiError(422, 'VALIDATION_ERROR', '结算系数必须是大于等于 0 的数字')
    bill.coefficient = c
  }
  // 顺序很关键：先按新明细/公式重算单据合计，再用「新金额」校验并分摊成本中心；
  // 反过来的话会拿旧金额去校验新成本中心（驳回后改金额必被误拦）
  if (body.items !== undefined || body.formula !== undefined || body.coefficient !== undefined) {
    // 公式/系数/明细任一变化都要按当前口径整体重算
    const rawItems = body.items !== undefined ? body.items : await loadItems(bill.id)
    const details = normalizeItems(rawItems, bill.formula, { 系数: bill.coefficient })
    await writeItems(bill.id, details)
    Object.assign(bill, sumTotals(details))
    bill.finance = null // 金额口径变了，旧核算作废
  }
  if (body.costCenters !== undefined) bill.costCenters = normalizeCostCenters(body.costCenters, billAllocBase(bill))
  if (bill.costCenters?.length) bill.costCenters = allocateCostCenters(bill.costCenters, billAllocBase(bill))
  bill.updatedAt = nowText()
  await saveBill(bill)
  audit('finance.bill.update', user, bill)
  return getBillDetail(user, bill.id)
}

export async function deleteBill(user, id) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  assertSupplierVisible(user, bill)
  const isOwnerSupplier = hasRole(user, ROLE.VENDOR_TL) && sameSupplier(bill, user)
  if (!isOwnerSupplier && !hasRole(user, ROLE.CLIENT_PM)) {
    throw new ApiError(403, 'FORBIDDEN', '无权删除该结算单')
  }
  // 管理员（role 1）可强制删除任意状态的单据（用于清理误建/测试数据）；其余角色仍需未确认
  if ((bill.confirms || []).length > 0 && !hasRole(user, ROLE.CLIENT_PM)) {
    throw new ApiError(409, 'BILL_STATE_CONFLICT', '已有确认记录的结算单不可删除，请走驳回流程')
  }
  await deleteBillRow(bill.id)
  const index = bills.findIndex(b => b.id === bill.id)
  if (index >= 0) bills.splice(index, 1)
  audit('finance.bill.delete', user, bill)
  return { deleted: true, billNo: bill.billNo }
}

// 公式校验 + 逐行试算：返回每行金额与合计，供导入预览使用（与正式结算同一套口径）
export function previewFormula(user, body = {}) {
  requireBillRoles(user)
  const formula = validateFormula(body.formula)
  const coefficient = body.coefficient === undefined || body.coefficient === '' ? 1 : Number(body.coefficient)
  if (!Number.isFinite(coefficient) || coefficient < 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '结算系数必须是大于等于 0 的数字')
  }
  const rows = Array.isArray(body.items) ? body.items.slice(0, 200) : []
  const compiled = compileFormula(formula)
  const computed = rows.map((r) => {
    const quantity = Number(r.quantity) || 0
    const unitPrice = Number(r.unitPrice) || 0
    const declared = r.amount === undefined || r.amount === null || r.amount === '' ? 0 : Number(r.amount)
    return {
      taskName: String(r.taskName || '').trim(),
      quantity, unitPrice,
      sourceAmount: declared,
      amount: compiled.evaluate({ quantity, unitPrice, amount: declared, 系数: r.系数 }, { 系数: coefficient })
    }
  })
  return {
    formula,
    coefficient,
    variables: FORMULA_VARS,
    rows: computed,
    totalAmount: Number(computed.reduce((sum, r) => sum + r.amount, 0).toFixed(2)),
    previewCount: computed.length
  }
}

// 抄送统一结算方：飞书推送 + 站内待办（单据全部确认通过后，提示统结方提交总金额）
function notifySettlementSubmitter(bill) {
  const scope = computeSupplierConfirmedTotal({ period: bill.period })
  const content = [
    billSummary(bill),
    `结算周期：${bill.period || '(未指定)'}`,
    `当前供应商确认合计：¥${scope.supplierTotal}（${scope.supplierCount} 家 / ${scope.billCount} 张）`,
    '本单已走完全部确认（含 OA 结算确认）'
  ].join(' · ')
  const title = `【结算完成】本周期统结数据已确认${bill.period ? '（' + bill.period + '）' : ''}`
  // 只发给「统一结算方（柏川）」本人：账号上标记 isSettlementParty；
  // 未指定时先发给内部跟进（甲方PM/财务），绝不群发全体供应商
  const parties = users.filter(u => !u.disabled && u.isSettlementParty)
  if (parties.length) {
    const partyText = parties.map(u => `统结方-${u.userName}`).join('、')
    createNotification(parties.map(u => u.id), 'finance', title,
      content.replace('本单已走完全部确认（含 OA 结算确认）', `${partyText} 提交的统结数据已通过财务二次确认，本单已走完全部确认（含 OA 结算确认）`), 'settlement', bill.id)
    notifyRoles([ROLE.CLIENT_PM, ROLE.FINANCE], 'finance',
      `【已抄送 ${partyText}】${bill.batchName}`, content, 'settlement', bill.id)
  } else {
    notifyRoles([ROLE.CLIENT_PM, ROLE.FINANCE], 'todo', title,
      content + '（尚未在账号上指定「统一结算方」，请先指定后由统结方提交）', 'settlement', bill.id)
  }
}

export function increaseCheck(bill) {
  const base = Number(bill.totalAmount) || 0
  const finalAmount = bill.finance ? Number(bill.finance.payableAmount) : base
  if (base <= 0) return { base, finalAmount, rate: 0, ratePercent: 0, exceeded: false, limitPercent: roundPercent(MAX_INCREASE_RATE * 100) }
  const rate = (finalAmount - base) / base
  return {
    base,
    finalAmount,
    rate: Number(rate.toFixed(6)),
    ratePercent: roundPercent(rate * 100),
    exempt: base,
    exceeded: rate > MAX_INCREASE_RATE + 1e-9,
    limitPercent: roundPercent(MAX_INCREASE_RATE * 100)
  }
}

function assertIncreaseWithinLimit(bill, user) {
  const check = increaseCheck(bill)
  if (!check.exceeded) return check
  // 超限：推送报警（飞书 + 站内），并阻断本次提交
  const content = [
    billSummary(bill),
    `供应商提交金额：¥${check.base}`,
    `本次结算金额：¥${check.finalAmount}`,
    `增幅：${check.ratePercent}%（上限 ${check.limitPercent}%）`,
    `提交人：${user ? actorText(user) : '-'}`
  ].join('\n')
  notifyRoles([ROLE.CLIENT_PM, ROLE.FINANCE, ROLE.LEADER], 'finance',
    `【结算增幅超限·已拦截】${bill.batchName}`, content, 'bill', bill.id)
  throw new ApiError(422, 'INCREASE_LIMIT_EXCEEDED',
    `结算金额较供应商提交金额增幅 ${check.ratePercent}%，超过 ${check.limitPercent}% 上限：已推送报警，本次提交被拦截`)
}

// 供应商确认金额合计（不含统结方账号自己的单）：统结方提交与财务二次确认的对比基准
function supplierBaseAmount(bill) {
  // 口径：同项目 + 同结算周期。只按项目汇总会把该供应商不同批次/不同周期的单一起加上，
  // 与统结方「本期提交额」不可比（周期为空时退化为按项目汇总，界面上会标注）
  const scope = computeSupplierConfirmedTotal({ projectId: bill.projectId, period: bill.period })
  const partyNames = new Set(users.filter(u => !u.disabled && hasRole(u, ROLE.SETTLEMENT))
    .map(u => String(u.userName || '').trim()))
  const suppliers = (scope.suppliers || []).filter(s => !partyNames.has(String(s.supplierName || '').trim()))
  return {
    base: roundMoney(suppliers.reduce((sum, s) => sum + s.amount, 0)),
    supplierCount: suppliers.length,
    billCount: suppliers.reduce((n, s) => n + s.billCount, 0),
    // 参与合计的供应商姓名（对比区块显示具体是谁）
    suppliers: suppliers.map(s => s.supplierName)
  }
}

// ===== 成本中心报表：按占比分摊后的金额汇总（后续据此出报表）=====
export function costCenterReport(user, query = {}) {
  requireBillRoles(user)
  const period = String(query.period || '').trim()
  const projectId = Number(query.projectId || 0)
  const dateFrom = String(query.dateFrom || '').trim()
  const dateTo = String(query.dateTo || '').trim()

  let list = bills.filter(b => b.status !== 'REJECTED')
  if (period) list = list.filter(b => String(b.period || '') === period)
  if (projectId) list = list.filter(b => b.projectId === projectId)
  if (dateFrom) list = list.filter(b => String(b.createdAt || '') >= dateFrom)
  if (dateTo) list = list.filter(b => String(b.createdAt || '') <= dateTo + ' 23:59:59')

  const map = {}
  let unscopedAmount = 0
  let unscopedBills = 0
  for (const b of list) {
    const centers = b.costCenters || []
    if (!centers.length) {
      unscopedBills++
      unscopedAmount += billAllocBase(b)
      continue
    }
    for (const c of centers) {
      const row = map[c.name] || (map[c.name] = {
        name: c.name, billCount: 0, ratioSum: 0, amount: 0, suppliers: new Set()
      })
      row.billCount++
      row.ratioSum += Number(c.ratio) || 0
      row.amount += Number(c.amount) || 0
      row.suppliers.add(b.supplierName)
    }
  }

  const items = Object.values(map)
    .map(r => ({
      name: r.name,
      billCount: r.billCount,
      // 占比在不同单据间不可直接相加，这里给"按金额加权的平均占比"
      avgRatio: r.amount > 0 ? roundPercent(r.ratioSum / r.billCount) : 0,
      amount: roundMoney(r.amount),
      supplierCount: r.suppliers.size
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    period,
    projectId: projectId || null,
    billCount: list.length,
    totalAmount: roundMoney(list.reduce((sum, b) => sum + billAllocBase(b), 0)),
    costCenters: items,
    unscoped: { billCount: unscopedBills, amount: roundMoney(unscopedAmount) },
    limitPercent: roundPercent(MAX_INCREASE_RATE * 100)
  }
}

// ===== 供应商确认金额合计（统一结算与财务二次确认都用它）=====
// 口径：同项目/同周期内未驳回的单据，按供应商姓名归集（供应商身份以姓名为准）
export function computeSupplierConfirmedTotal(query = {}) {
  const period = String(query.period || '').trim()
  const supplierNames = Array.isArray(query.supplierNames)
    ? query.supplierNames.map(x => String(x).trim()).filter(Boolean) : []
  const projectId = Number(query.projectId || 0)
  let list = bills.filter(b => b.status !== 'REJECTED')
  if (period) list = list.filter(b => String(b.period || '') === period)
  if (supplierNames.length) list = list.filter(b => supplierNames.includes(String(b.supplierName || '').trim()))
  if (projectId) list = list.filter(b => b.projectId === projectId)
  const bySupplier = {}
  for (const b of list) {
    const sKey = String(b.supplierName || '未填供应商').trim()
    const row = bySupplier[sKey] || (bySupplier[sKey] = { supplierName: sKey, billCount: 0, amount: 0 })
    row.billCount++
    row.amount += Number(b.totalAmount) || 0
  }
  return {
    billCount: list.length,
    supplierCount: Object.keys(bySupplier).length,
    supplierTotal: roundMoney(list.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0)),
    suppliers: Object.values(bySupplier).map(r => ({ ...r, amount: roundMoney(r.amount) })).sort((a, b) => b.amount - a.amount)
  }
}

// 统结方（柏川）上传/建单后：自动与「同项目其他供应商确认金额合计」对比
// 结果记录在单据上，并通知财务查看；增幅超 3.5% 时同时告警
export function compareWithProject(bill, actor) {
  const { base, supplierCount, suppliers: supplierNames } = supplierBaseAmount(bill)
  const submitted = Number(bill.totalAmount) || 0
  const difference = roundMoney(submitted - base)
  const ratePercent = base > 0 ? roundPercent(difference / base * 100) : 0
  const limitPercent = roundPercent(MAX_INCREASE_RATE * 100)
  const exceeded = base > 0 && ratePercent > limitPercent
  return {
    base,                       // 同项目其他供应商确认金额合计
    submitted,                  // 统结方本次提交金额
    difference,
    ratePercent,
    limitPercent,
    exceeded,
    period: bill.period || '',
    supplierCount,
    suppliers: supplierNames,
    projectName: bill.projectName || '',
    comparedAt: nowText(),
    comparedBy: actor?.userName || ''
  }
}

// 统结方提交总金额 → 与供应商确认金额合计对比（独立入口，供财务核对用）
export function checkTotalSubmission(user, body = {}) {
  requireBillRoles(user)
  const submittedTotal = Number(body.submittedTotal)
  if (!Number.isFinite(submittedTotal) || submittedTotal < 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请填写有效的统一结算总金额')
  }
  const scope = computeSupplierConfirmedTotal(body)
  const base = scope.supplierTotal
  const rate = base > 0 ? (submittedTotal - base) / base : 0
  const ratePercent = roundPercent(rate * 100)
  const limitPercent = roundPercent(MAX_INCREASE_RATE * 100)
  const exceeded = base > 0 && rate > MAX_INCREASE_RATE + 1e-9

  const result = {
    ...scope,
    submittedTotal: roundMoney(submittedTotal),
    difference: roundMoney(submittedTotal - base),
    ratePercent,
    limitPercent,
    exceeded,
    period: String(body.period || ''),
    submittedBy: String(body.submittedBy || user.userName || '')
  }

  if (exceeded) {
    const lines = [
      `结算周期：${result.period || '(未指定)'}`,
      `供应商确认金额合计：¥${base}（${scope.supplierCount} 家供应商 / ${scope.billCount} 张单）`,
      `统结方提交总金额：¥${result.submittedTotal}`,
      `增幅：${ratePercent}%（上限 ${limitPercent}%）`,
      `提交人：统结方-${result.submittedBy}`
    ]
    notifyRoles([ROLE.CLIENT_PM, ROLE.FINANCE, ROLE.LEADER], 'finance',
      `【统一结算增幅超限·已拦截】${result.period || ''}`.trim(), lines.join('\n'), 'settlement', 0)
    audit('finance.settlement.totalCheck', user, { id: 0, billNo: '-', batchName: result.period }, { submittedTotal: result.submittedTotal, base, ratePercent, exceeded: true })
    throw new ApiError(422, 'INCREASE_LIMIT_EXCEEDED',
      `统结方提交总金额 ¥${result.submittedTotal} 较供应商确认合计 ¥${base} 增幅 ${ratePercent}%，超过 ${limitPercent}% 上限：已推送报警，本次提交被拦截`)
  }
  audit('finance.settlement.totalCheck', user, { id: 0, billNo: '-', batchName: result.period }, { submittedTotal: result.submittedTotal, base, ratePercent, exceeded: false })
  return result
}

// 财务核算：核算基础金额 → 扣款/税率 → 应付金额（仅「待财务确认」阶段可核算）
export async function calculateBill(user, id, body = {}) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  assertSupplierVisible(user, bill)
  if (!hasAnyRole(user, [ROLE.FINANCE, ROLE.CLIENT_PM])) {
    throw new ApiError(403, 'FORBIDDEN', '仅财务或管理员可进行财务核算')
  }
  if (bill.status !== 'PENDING_FINANCE') {
    throw new ApiError(409, 'BILL_STATE_CONFLICT', `仅「待财务确认」状态的单据可核算（当前：${BILL_STATUS[bill.status] || bill.status}）`)
  }
  const deduction = Number(body.deduction) || 0
  const taxRate = Number(body.taxRate) || 0
  if (taxRate < 0 || taxRate > 100) throw new ApiError(422, 'VALIDATION_ERROR', '税率需在 0~100 之间')
  const note = String(body.note || '').trim()

  const baseAmount = bill.totalAmount
  const netAmount = roundMoney(baseAmount - deduction)
  const taxAmount = roundMoney(netAmount * taxRate / 100)
  const payableAmount = roundMoney(netAmount + taxAmount)

  bill.finance = {
    baseAmount, deduction, taxRate, netAmount, taxAmount, payableAmount, note,
    calculatedBy: user.id, calculatedByName: user.userName, calculatedAt: nowText()
  }
  // 成本中心按最终应付金额重新分摊
  if (bill.costCenters?.length) bill.costCenters = allocateCostCenters(bill.costCenters, payableAmount)
  bill.updatedAt = nowText()
  await saveBill(bill)
  audit('finance.bill.calculate', user, bill, { deduction, taxRate, payableAmount })
  const detail = await getBillDetail(user, bill.id)
  const check = increaseCheck(bill)
  detail.increaseCheck = check
  if (check.exceeded) {
    // 保存核算结果，但明确告知：超限则无法提交
    notifyRoles([ROLE.CLIENT_PM, ROLE.FINANCE, ROLE.LEADER], 'finance',
      `【结算增幅超限·待处理】${bill.batchName}`,
      [billSummary(bill), `供应商提交金额：¥${check.base}`, `本次结算金额：¥${check.finalAmount}`,
        `增幅：${check.ratePercent}%（上限 ${check.limitPercent}%）`,
        `操作人：${actorText(user)}`].join('\n'), 'bill', bill.id)
  }
  return detail
}

// 确认通过：推进到下一节点；末节点通过后整单 APPROVED
export async function confirmBill(user, id, body = {}) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  const stageIndex = assertConfirmable(user, bill)
  const stage = BILL_STAGES[stageIndex]
  const comment = String(body.comment || '').trim()
  // 第一环节（业务工程师确认）：已指派时只有被指派的工程师能确认
  if (stage.key === 'BIZ') {
    if (!bill.assigneeId) {
      throw new ApiError(409, 'ASSIGN_REQUIRED', '该单据尚未指派工程师，请先由财务指定确认人')
    }
    if (Number(bill.assigneeId) !== Number(user.id)) {
      throw new ApiError(403, 'FORBIDDEN', `该单据已指派给 ${bill.assigneeName || '其他工程师'}，你不是该单据的确认人`)
    }
  }
  // 财务节点必须先完成核算，保证"每一单都经财务计算"
  if (stage.key === 'FINANCE' && !bill.finance?.calculatedAt) {
    throw new ApiError(422, 'FINANCE_CALC_REQUIRED', '请先完成财务核算，再确认通过')
  }
  // 核算后金额相对供应商提交金额的增幅校验（单张单据口径）
  if (['FINANCE', 'LEADER', 'PERCEPTION'].includes(stage.key)) {
    assertIncreaseWithinLimit(bill, user)
  }

  // 统结方节点：导入/解析明细表 → 系统自动汇总金额并保存（提交即完成本环节，不再手填总金额）
  // 增幅对比改由下一步「财务二次确认」校验
  let settlementInfo = null
  if (stage.key === 'SETTLEMENT' && !(Array.isArray(body.items) && body.items.length)) {
    throw new ApiError(422, 'SETTLEMENT_REQUIRED', '请导入统结明细（Excel/CSV 或粘贴）后再提交')
  }
  if (stage.key === 'SETTLEMENT' && !(normalizeAttachments(body.attachments) || []).length) {
    throw new ApiError(422, 'ATTACHMENT_REQUIRED', '请上传「附件（明细数据）」后再提交')
  }
  if (stage.key === 'SETTLEMENT' && Array.isArray(body.items) && body.items.length) {
    const details = normalizeItems(body.items, bill.formula, { 系数: bill.coefficient })
    const totals = sumTotals(details)
    const { base, supplierCount, billCount, suppliers: baseSupplierNames } = supplierBaseAmount(bill)
    const difference = roundMoney(totals.totalAmount - base)
    const ratePercent = base > 0 ? roundPercent(difference / base * 100) : 0
    const attachments = normalizeAttachments(body.attachments) || []
    if (attachments.length) bill.attachments = [...(bill.attachments || []), ...attachments]
    settlementInfo = {
      source: 'import',
      items: details,
      itemCount: totals.itemCount,
      totalQuantity: totals.totalQuantity,
      submittedTotal: totals.totalAmount,
      supplierTotal: base,
      period: bill.period || '',
      supplierCount,
      billCount,
      suppliers: baseSupplierNames,
      difference,
      increasePercent: ratePercent,
      limitPercent: roundPercent(MAX_INCREASE_RATE * 100),
      attachments,
      costCenters: normalizeCostCenters(body.costCenters, totals.totalAmount),
      period: bill.period || '',
      submittedBy: actorText(user)
    }
  } else if (stage.key === 'SETTLEMENT') {
    // 统结方与供应商同口径：必须导入明细 + 上传附件（金额由明细自动汇总），不再支持"只填总金额"
    throw new ApiError(422, 'VALIDATION_ERROR', '请导入统结明细（Excel/CSV）并上传附件后提交')
  }

  // 财务二次确认：供应商合计 vs 统结方提交合计，超 3.5% 报警且确认不了
  let comparisonInfo = null
  if (stage.key === 'FINANCE2') {
    const settled = [...bill.confirms].reverse().find(c => c.stageKey === 'SETTLEMENT' && c.settlement)
    const submitted = settled ? Number(settled.settlement.submittedTotal) || 0 : 0
    if (!submitted) throw new ApiError(409, 'SETTLEMENT_REQUIRED', '统结方尚未提交数据，无法进行财务二次确认')
    const { base, supplierCount, billCount, suppliers: supplierNames } = supplierBaseAmount(bill)
    const difference = roundMoney(submitted - base)
    const ratePercent = base > 0 ? roundPercent(difference / base * 100) : 0
    const limitPercent = roundPercent(MAX_INCREASE_RATE * 100)
    const exceeded = base > 0 && ratePercent > limitPercent
    if (exceeded) {
      notifyRoles([ROLE.CLIENT_PM, ROLE.FINANCE, ROLE.LEADER], 'finance',
        `【统结增幅超限·已拦截】${bill.batchName}`,
        [billSummary(bill),
          `供应商确认合计：¥${base}（${supplierCount} 家 / ${billCount} 张）`,
          `统结方提交：¥${submitted}`,
          `增幅：${ratePercent}%（上限 ${limitPercent}%）`,
          `操作人：${actorText(user)}`].join('\n'), 'bill', bill.id)
      audit('finance.bill.compareBlock', user, bill, { base, submitted, ratePercent, exceeded: true })
      throw new ApiError(422, 'INCREASE_LIMIT_EXCEEDED',
        `统结方提交 ¥${submitted} 较供应商确认合计 ¥${base} 增幅 ${ratePercent}%，超过 ${limitPercent}% 上限：已推送报警，本次二次确认被拦截`)
    }
    comparisonInfo = {
      base, submitted, difference, ratePercent, limitPercent, exceeded: false,
      period: bill.period || '', projectId: bill.projectId || null,
      supplierCount, billCount, suppliers: supplierNames, projectName: bill.projectName || '',
      comparedAt: nowText(), comparedBy: user.userName
    }
    bill.comparison = comparisonInfo        // 列表「统结对比」列直接展示
  }

  bill.confirms.push({
    stage: stageIndex, stageKey: stage.key, stageLabel: stage.label,
    roleType: stage.roleType, userId: user.id, userName: user.userName,
    // 轮次：供应商每重新提交一次就 +1；链路进度只认当前轮，避免上一轮的"已通过"残留
    round: bill.resubmitCount || 0,
    action: 'APPROVE', comment, at: nowText(),
    ...(settlementInfo ? { settlement: settlementInfo } : {}),
    ...(comparisonInfo ? { comparison: comparisonInfo } : {})
  })
  bill.currentStage = stageIndex + 1
  bill.rejected = false
  bill.rejectReason = ''
  bill.updatedAt = nowText()
  if (bill.currentStage >= stageCount()) bill.approvedAt = nowText()
  bill.status = deriveStatus(bill)
  await saveBill(bill)

  audit('finance.bill.confirm', user, bill, { stageKey: stage.key, comment })
  if (bill.status === 'APPROVED') {
    // 末节点（OA 结算专员）通过：回执供应商（仅本单所属）与甲方PM
    notifySupplier(bill, `【已全部确认】${bill.batchName}`,
      `${roleNameOf(stage)}-${user.userName} 已确认通过，确认链（业务工程师→财务→统结方→财务二次确认→负责人→算法→OA结算）已全部通过。`)
    notifyRoles([ROLE.CLIENT_PM], 'finance', `【结算单已完成】${bill.batchName}`,
      `${billSummary(bill)}\n${roleNameOf(stage)}-${user.userName} 已确认通过，确认链全部通过。`, 'bill', bill.id)
    notifySubmitter(bill, stage, user.userName, null)
    // 单据全部确认通过 → 抄送统一结算方（完成通知，飞书 + 站内）
    notifySettlementSubmitter(bill)
  } else {
    // 中间节点通过：提醒下一环节 + 回执提交人
    notifyNextStage(bill)
    notifySubmitter(bill, stage, user.userName, currentStage(bill))
  }
  return getBillDetail(user, bill.id)
}

// 驳回：任一节点驳回即整单退回供应商
export async function rejectBill(user, id, body = {}) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  const stageIndex = assertConfirmable(user, bill)
  const stage = BILL_STAGES[stageIndex]
  const reason = String(body.reason || body.comment || '').trim()
  if (!reason) throw new ApiError(422, 'REJECT_REASON_REQUIRED', '请填写驳回原因')

  bill.rejections.push({
    stage: stageIndex, stageKey: stage.key, stageLabel: stage.label,
    roleType: stage.roleType, userId: user.id, userName: user.userName,
    action: 'REJECT', reason, at: nowText()
  })
  bill.rejected = true
  bill.rejectReason = `【${stage.label}】${reason}`
  bill.status = deriveStatus(bill)
  bill.updatedAt = nowText()
  await saveBill(bill)

  audit('finance.bill.reject', user, bill, { stageKey: stage.key, reason })
  notifySupplier(bill, `结算单被驳回：${bill.batchName}`,
    `结算单 ${bill.billNo} 被 ${roleNameOf(stage)}-${user.userName} 驳回：${reason}，请修正后重新提交`)
  return getBillDetail(user, bill.id)
}

// 供应商修正后重新提交：确认链从第一节点重新开始
export async function resubmitBill(user, id) {
  requireBillRoles(user)
  const bill = findBillOr404(id)
  assertSupplierVisible(user, bill)
  const isOwnerSupplier = hasRole(user, ROLE.VENDOR_TL) && sameSupplier(bill, user)
  if (!isOwnerSupplier) throw new ApiError(403, 'FORBIDDEN', '仅该结算单的供应商可重新提交')
  if (bill.status !== 'REJECTED') throw new ApiError(409, 'BILL_STATE_CONFLICT', '仅被驳回的结算单可重新提交')

  bill.rejected = false
  bill.rejectReason = ''
  bill.currentStage = 0
  bill.resubmitCount = (bill.resubmitCount || 0) + 1
  bill.finance = null // 金额可能变化，旧核算作废
  // 把上一轮确认记录显式标记为旧轮次（此后不再依赖时间推断）
  for (const c of bill.confirms || []) {
    if (typeof c.round !== 'number') c.round = (bill.resubmitCount || 1) - 1
  }
  bill.status = deriveStatus(bill)
  bill.updatedAt = nowText()
  await saveBill(bill)

  audit('finance.bill.resubmit', user, bill, { resubmitCount: bill.resubmitCount })
  notifyNextStage(bill)
  if (bill.createdBy) {
    createNotification([bill.createdBy], 'finance', `【已重新提交】${bill.batchName}`,
      `${billSummary(bill)}\n${actorText(user)} 修正后重新提交（第 ${bill.resubmitCount} 次），确认流程已重新开始，当前环节：${handlerText(bill, BILL_STAGES[0])}`, 'bill', bill.id)
  }
  return getBillDetail(user, bill.id)
}

// 看板统计（按角色数据范围）
export function billStats(user) {
  requireBillRoles(user)
  let list = bills.slice()
  if (isSupplierOnly(user)) {
    const asSettlementParty = hasRole(user, ROLE.SETTLEMENT)
    list = list.filter(b =>
      sameSupplier(b, user) ||
      (asSettlementParty && b.status === 'PENDING_SETTLEMENT')
    )
  }

  const byStatus = {}
  const amountByStatus = {}
  Object.keys(BILL_STATUS).forEach(k => { byStatus[k] = 0; amountByStatus[k] = 0 })
  let pendingAmount = 0
  let approvedAmount = 0
  let myTodoCount = 0
  let myTodoAmount = 0
  list.forEach(b => {
    byStatus[b.status] = (byStatus[b.status] || 0) + 1
    amountByStatus[b.status] = (amountByStatus[b.status] || 0) + b.totalAmount
    if (b.status === 'APPROVED') approvedAmount += b.totalAmount
    else if (b.status !== 'REJECTED') pendingAmount += b.totalAmount
    // 待我处理：第一环节按被指派的工程师算
    if (isMyTurn(user, b)) { myTodoCount++; myTodoAmount += b.totalAmount }
  })
  Object.keys(amountByStatus).forEach(k => { amountByStatus[k] = roundMoney(amountByStatus[k]) })

  const supplierMap = {}
  const projectMap = {}
  list.forEach(b => {
    const bKey = String(b.supplierName || '未填供应商').trim()
    const row = supplierMap[bKey] || (supplierMap[bKey] = {
      supplierName: bKey, billCount: 0, approvedAmount: 0, pendingAmount: 0
    })
    row.billCount++
    if (b.status === 'APPROVED') row.approvedAmount += b.totalAmount
    else if (b.status !== 'REJECTED') row.pendingAmount += b.totalAmount

    const key = b.projectId || 0
    const prow = projectMap[key] || (projectMap[key] = {
      projectId: b.projectId || null, projectName: b.projectName || '未归属项目', billCount: 0,
      approvedAmount: 0, pendingAmount: 0, pendingCount: 0
    })
    prow.billCount++
    if (b.status === 'APPROVED') prow.approvedAmount += b.totalAmount
    else if (b.status !== 'REJECTED') { prow.pendingAmount += b.totalAmount; prow.pendingCount++ }
  })

  return {
    total: list.length,
    myTodoCount,
    pendingCount: Object.entries(byStatus).filter(([k]) => k.startsWith('PENDING_')).reduce((s, [, v]) => s + v, 0),
    approvedCount: byStatus.APPROVED || 0,
    rejectedCount: byStatus.REJECTED || 0,
    myTodoAmount: roundMoney(myTodoAmount),
    calculatedCount: list.filter(b => b.finance?.calculatedAt).length,
    payableAmount: roundMoney(list.filter(b => b.status === 'APPROVED').reduce((sum, b) => sum + (b.finance?.payableAmount ?? b.totalAmount), 0)),
    pendingPayableAmount: roundMoney(list.filter(b => b.status !== 'APPROVED' && b.status !== 'REJECTED').reduce((sum, b) => sum + (b.finance?.payableAmount ?? b.totalAmount), 0)),
    pendingAmount: roundMoney(pendingAmount),
    approvedAmount: roundMoney(approvedAmount),
    byStatus,
    amountByStatus,
    projects: Object.values(projectMap)
      .map(r => ({ ...r, approvedAmount: roundMoney(r.approvedAmount), pendingAmount: roundMoney(r.pendingAmount) }))
      .sort((a, b) => b.approvedAmount - a.approvedAmount),
    suppliers: Object.values(supplierMap)
      .map(r => ({ ...r, approvedAmount: roundMoney(r.approvedAmount), pendingAmount: roundMoney(r.pendingAmount) }))
      .sort((a, b) => b.approvedAmount - a.approvedAmount)
  }
}

// 明细级对账导出（CSV，按当前筛选条件全量导出）
export async function exportBillsCsv(user, query) {
  const list = filterBills(user, query)
  const billMap = new Map(list.map(b => [b.id, b]))
  const rows = [['结算单号', '所属项目', '批次名称', '供应商', '单据状态', '项目', '数据类型', '验收日期', '数量', '单价（RMB）', '总金额（RMB）', '数据路径', '备注', '基础金额', '扣款', '税率(%)', '应付金额', '核算人', '核算时间']]
  const exportItems = await loadItemsForBills([...billMap.keys()])
  exportItems
    .forEach(i => {
      const b = billMap.get(i.billId)
      const fin = b.finance || {}
      rows.push([b.billNo, b.projectName || '', b.batchName, b.supplierName, BILL_STATUS[b.status] || b.status, i.taskName,
        i.dataType, i.acceptDate, i.quantity, i.unitPrice, i.amount, i.dataPath, i.remark,
        fin.baseAmount ?? b.totalAmount, fin.deduction ?? '', fin.taxRate ?? '', fin.payableAmount ?? '',
        fin.calculatedByName || '', fin.calculatedAt || ''])
    })
  const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
  return { fileName: `验收结算单_${todayText()}.csv`, content: csv, rowCount: rows.length - 1 }
}

// ===== 结算汇总看板（数据仪表盘）：累积结算 + 成本中心金额分布 + 周期累积 =====
// 口径说明：金额用「应付金额」优先（财务核算过），未核算时退回基础金额；
// 「已结算」= 流程走完(APPROVED)，其余未驳回的算「在途」。供应商维度按姓名归集。
export function settlementSummary(user, query = {}) {
  requireBillRoles(user)
  const period = String(query.period || '').trim()
  const projectId = Number(query.projectId || 0)
  const dateFrom = String(query.dateFrom || '').trim()
  const dateTo = String(query.dateTo || '').trim()

  let list = bills.slice()
  if (isSupplierOnly(user)) {
    const asSettlementParty = hasRole(user, ROLE.SETTLEMENT)
    list = list.filter(b => sameSupplier(b, user) || (asSettlementParty && b.status === 'PENDING_SETTLEMENT'))
  }
  if (period) list = list.filter(b => String(b.period || '') === period)
  if (projectId) list = list.filter(b => b.projectId === projectId)
  if (dateFrom) list = list.filter(b => String(b.createdAt || '') >= dateFrom)
  if (dateTo) list = list.filter(b => String(b.createdAt || '') <= dateTo + ' 23:59:59')

  const payableOf = (b) => {
    const p = b.finance?.payableAmount
    return Number(p === undefined || p === null ? b.totalAmount : p) || 0
  }
  const isSettled = (b) => b.status === 'APPROVED'
  const isPending = (b) => b.status !== 'APPROVED' && b.status !== 'REJECTED'

  const totals = {
    billCount: 0, settledCount: 0, pendingCount: 0, rejectedCount: 0,
    itemCount: 0, totalQuantity: 0, amount: 0, settledAmount: 0, pendingAmount: 0,
    baseAmount: 0, deduction: 0, taxAmount: 0
  }
  const supplierMap = {}
  const costMap = {}
  const periodMap = {}
  const projectMap = {}

  for (const b of list) {
    const payable = payableOf(b)
    const fin = b.finance || {}
    totals.billCount++
    if (isSettled(b)) { totals.settledCount++; totals.settledAmount += payable }
    else if (isPending(b)) { totals.pendingCount++; totals.pendingAmount += payable }
    else totals.rejectedCount++
    totals.itemCount += Number(b.itemCount) || 0
    totals.totalQuantity += Number(b.totalQuantity) || 0
    totals.amount += payable
    totals.baseAmount += Number(b.totalAmount) || 0
    totals.deduction += Number(fin.deduction) || 0
    totals.taxAmount += Number(fin.taxAmount) || 0

    // 供应商维度（姓名口径）
    const sKey = String(b.supplierName || '未填供应商').trim()
    const sup = supplierMap[sKey] || (supplierMap[sKey] = {
      supplierName: sKey, billCount: 0, settledCount: 0, pendingCount: 0,
      itemCount: 0, totalQuantity: 0, amount: 0, settledAmount: 0, pendingAmount: 0,
      baseAmount: 0, deduction: 0, lastPeriod: '', lastAt: '', periods: new Set(), projects: new Set()
    })
    sup.billCount++
    if (isSettled(b)) { sup.settledCount++; sup.settledAmount += payable }
    else if (isPending(b)) { sup.pendingCount++; sup.pendingAmount += payable }
    sup.itemCount += Number(b.itemCount) || 0
    sup.totalQuantity += Number(b.totalQuantity) || 0
    sup.amount += payable
    sup.baseAmount += Number(b.totalAmount) || 0
    sup.deduction += Number(fin.deduction) || 0
    if (b.period) sup.periods.add(String(b.period))
    if (b.projectName) sup.projects.add(String(b.projectName))
    const at = String(b.approvedAt || b.updatedAt || b.createdAt || '')
    if (at > sup.lastAt) { sup.lastAt = at; sup.lastPeriod = String(b.period || '') }

    // 成本中心金额分布（单据上已按占比分摊好金额）
    const centers = b.costCenters || []
    if (centers.length) {
      for (const c of centers) {
        const cKey = String(c.name || '未命名').trim()
        const row = costMap[cKey] || (costMap[cKey] = { name: cKey, amount: 0, billCount: 0, ratioSum: 0, suppliers: new Set() })
        row.amount += Number(c.amount) || 0
        row.billCount++
        row.ratioSum += Number(c.ratio) || 0
        row.suppliers.add(sKey)
      }
    } else {
      const row = costMap['未填成本中心'] || (costMap['未填成本中心'] = { name: '未填成本中心', amount: 0, billCount: 0, ratioSum: 0, suppliers: new Set() })
      row.amount += payable
      row.billCount++
      row.suppliers.add(sKey)
    }

    // 周期累积
    const pKey = String(b.period || '未填周期').trim()
    const prow = periodMap[pKey] || (periodMap[pKey] = { period: pKey, billCount: 0, amount: 0, settledAmount: 0, totalQuantity: 0 })
    prow.billCount++
    prow.amount += payable
    prow.totalQuantity += Number(b.totalQuantity) || 0
    if (isSettled(b)) prow.settledAmount += payable

    // 项目维度
    const prKey = b.projectId || 0
    const proj = projectMap[prKey] || (projectMap[prKey] = { projectId: b.projectId || null, projectName: b.projectName || '未归属项目', billCount: 0, amount: 0, settledAmount: 0 })
    proj.billCount++
    proj.amount += payable
    if (isSettled(b)) proj.settledAmount += payable
  }

  const costCenters = Object.values(costMap)
    .map(r => ({
      name: r.name,
      amount: roundMoney(r.amount),
      billCount: r.billCount,
      avgRatio: r.billCount ? roundPercent(r.ratioSum / r.billCount) : 0,
      supplierCount: r.suppliers.size,
      // 金额占比（相对全部成本中心金额合计）
      amountPercent: 0
    }))
    .sort((a, b) => b.amount - a.amount)
  const ccTotal = costCenters.reduce((s, x) => s + x.amount, 0)
  costCenters.forEach(x => { x.amountPercent = ccTotal > 0 ? Number((x.amount / ccTotal * 100).toFixed(2)) : 0 })

  const suppliers = Object.values(supplierMap)
    .map(r => ({
      supplierName: r.supplierName,
      billCount: r.billCount, settledCount: r.settledCount, pendingCount: r.pendingCount,
      itemCount: r.itemCount, totalQuantity: Number(r.totalQuantity.toFixed(2)),
      amount: roundMoney(r.amount), settledAmount: roundMoney(r.settledAmount), pendingAmount: roundMoney(r.pendingAmount),
      baseAmount: roundMoney(r.baseAmount), deduction: roundMoney(r.deduction),
      // 结算完成度：已通过金额 / 累计金额
      settleRate: r.amount > 0 ? Number((r.settledAmount / r.amount * 100).toFixed(1)) : 0,
      lastPeriod: r.lastPeriod, lastAt: r.lastAt,
      periods: [...r.periods].sort().reverse(),
      projects: [...r.projects]
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    filters: { period, projectId: projectId || null, dateFrom, dateTo },
    totals: {
      ...totals,
      amount: roundMoney(totals.amount), settledAmount: roundMoney(totals.settledAmount),
      pendingAmount: roundMoney(totals.pendingAmount), baseAmount: roundMoney(totals.baseAmount),
      deduction: roundMoney(totals.deduction), taxAmount: roundMoney(totals.taxAmount),
      totalQuantity: Number(totals.totalQuantity.toFixed(2)),
      supplierCount: suppliers.length,
      costCenterCount: costCenters.length,
      settleRate: totals.amount > 0 ? Number((totals.settledAmount / totals.amount * 100).toFixed(1)) : 0
    },
    suppliers,
    costCenters,
    periods: Object.values(periodMap).sort((a, b) => String(a.period).localeCompare(String(b.period))),
    projects: Object.values(projectMap).map(p => ({ ...p, amount: roundMoney(p.amount), settledAmount: roundMoney(p.settledAmount) })).sort((a, b) => b.amount - a.amount)
  }
}
