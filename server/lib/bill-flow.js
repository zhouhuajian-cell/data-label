// 验收结算确认单 —— 四级确认流（工程师 → 财务 → 负责人 → 算法）
// 叫法与业务流程一致：工程师=罗桂林/彭晓蕾/赵晓伟，财务=张海霞，负责人=蔡总(蔡家辉)，算法=马成男
// 状态合法性唯一权威在服务端：账单 status 由 currentStage 推导，不提供"任意改 status"的接口。
//
// 角色号与 src/utils/constants.js 的 ROLE_TYPE 保持一致（后端各服务均直接使用角色数字，此处沿用）。
// 账号可持多角色（roleTypes），因此一律用 hasRole 判断，而非 === 主角色。
import { ApiError } from './http.js'
import { roundMoney } from './money.js'
import { hasRole, hasAnyRole, roleTypesOf } from './roles.js'

export const ROLE = {
  CLIENT_PM: 1,
  VENDOR_TL: 3,
  ANNOTATOR: 4,
  BIZ_ENGINEER: 13,
  FINANCE: 14,
  LEADER: 15,
  PERCEPTION: 16,
  SETTLEMENT: 17,
  // OA 结算专员：流程全部走完后，负责把该单录入 OA 系统做最新结算（非确认节点，只接通知/待办）
  OA_SETTLEMENT: 18,
  // 独立结算：供应商侧的身份标记——与统一结算方无合同关系，
  // 其单据财务确认后直达负责人（跳过「统结方提交」与「财务二次确认」）。
  // 注意：它不改变数据权限，仍是供应商口径（见 isSupplierOnly）。
  INDEPENDENT_SETTLE: 19
}

// 确认顺序即数组顺序，禁止跳步
export const BILL_STAGES = [
  { key: 'BIZ', label: '工程师确认', short: '工程师', roleName: '业务工程师', roleType: ROLE.BIZ_ENGINEER, status: 'PENDING_BIZ' },
  { key: 'FINANCE', label: '财务确认', short: '财务', roleName: '财务', roleType: ROLE.FINANCE, status: 'PENDING_FINANCE' },
  // 统一结算方（柏川）：提交本周期总金额，与各供应商确认金额合计做 3.5% 增幅校验
  // optional：与统结方无合同关系的供应商跳过此环节（见 SETTLEMENT_EXEMPT_SUPPLIERS）
  { key: 'SETTLEMENT', label: '统结方提交', short: '统结方', roleName: '统结方', roleType: ROLE.SETTLEMENT, status: 'PENDING_SETTLEMENT', optional: true },
  // 统结方提交后：供应商与统结方的结果汇总到财务做二次确认（3.5% 增幅在此校验）
  // optional：二次确认是为统结对比服务的，不走统结的供应商一并跳过
  { key: 'FINANCE2', label: '财务二次确认', short: '财务二次', roleName: '财务', roleType: ROLE.FINANCE, status: 'PENDING_FINANCE2', optional: true },
  { key: 'LEADER', label: '负责人确认', short: '负责人', roleName: '负责人', roleType: ROLE.LEADER, status: 'PENDING_LEADER' },
  { key: 'PERCEPTION', label: '算法确认', short: '算法', roleName: '算法', roleType: ROLE.PERCEPTION, status: 'PENDING_PERCEPTION' },
  // 末环节：OA 结算专员（彭桂苹）走 OA 系统最新结算后确认，确认完单据才算完成
  { key: 'OA', label: 'OA结算确认', short: 'OA', roleName: 'OA结算专员', roleType: ROLE.OA_SETTLEMENT, status: 'PENDING_OA' }
]

export const BILL_STATUS = {
  PENDING_BIZ: '待工程师确认',
  PENDING_FINANCE: '待财务确认',
  PENDING_SETTLEMENT: '待统结方提交',
  PENDING_FINANCE2: '待财务二次确认',
  PENDING_LEADER: '待负责人确认',
  PENDING_PERCEPTION: '待算法确认',
  PENDING_OA: '待OA结算确认',
  APPROVED: '已通过',
  REJECTED: '已驳回'
}

// ===== 独立结算（不经统结方）=====
// 与统一结算方之间没有合同关系的供应商：其单据财务确认后直接进入负责人，
// 跳过「统结方提交」与配套的「财务二次确认」（后者只为统结对比服务）。
// 判定依据是单据字段 settlementExempt —— 由账号是否持「独立结算」角色(19)解析而来，
// 在创建单据时写入、服务启动时对历史单据回填（见 services/bills.js）。
// 之所以快照到单据上：账号角色变更不应悄悄改写已有单据的流转路径。
export function isSettlementExempt(bill) {
  return bill?.settlementExempt === true
}

// 该环节对本单是否适用（optional 环节仅对免统结供应商跳过）
export function isStageApplicable(stage, bill) {
  if (!stage) return false
  if (!stage.optional) return true
  return !isSettlementExempt(bill)
}

// 本单实际要走的环节（保留原始数组下标，供 confirms.stage 与前端展示用）
export function stageListOf(bill) {
  return BILL_STAGES
    .map((s, index) => ({ ...s, index }))
    .filter(s => isStageApplicable(s, bill))
}

// 从 from（含）起向后找首个适用环节的下标；都不适用则返回 BILL_STAGES.length（表示链路走完）
export function nextApplicableIndex(bill, from = 0) {
  for (let i = Math.max(0, from); i < BILL_STAGES.length; i++) {
    if (isStageApplicable(BILL_STAGES[i], bill)) return i
  }
  return BILL_STAGES.length
}

// 当前环节下标：对历史单据或豁免名单变更做归一（指向已豁免环节时向后推进），
// 保证 currentStage 始终落在本单真正需要处理的环节上
export function currentStageIndex(bill) {
  const idx = Number(bill?.currentStage) || 0
  if (idx >= BILL_STAGES.length) return BILL_STAGES.length
  if (isStageApplicable(BILL_STAGES[idx], bill)) return idx
  return nextApplicableIndex(bill, idx + 1)
}

// 供应商可操作（编辑/删除/撤回）的状态：尚未有任何确认动作
export const EDITABLE_STATUSES = ['PENDING_BIZ']

export function stageCount() {
  return BILL_STAGES.length
}

// 行金额：优先 数量 × 单价；单价缺失（表格只给了合计）时回退到表格里的金额
export function computeRowAmount({ quantity = 0, unitPrice = 0, amount = 0 } = {}) {
  const q = Number(quantity) || 0
  const p = Number(unitPrice) || 0
  const a = Number(amount) || 0
  const value = p > 0 ? q * p : (a > 0 ? a : 0)
  return roundMoney(value)
}

// 当前待确认阶段；已通过/已驳回时返回 null
export function currentStage(bill) {
  if (bill.status === 'APPROVED' || bill.status === 'REJECTED') return null
  return BILL_STAGES[currentStageIndex(bill)] || null
}

// 由 currentStage + 驳回标记推导状态（唯一入口，禁止直接赋 status）
export function deriveStatus({ currentStage: stage, rejected }) {
  if (rejected) return 'REJECTED'
  if (stage >= BILL_STAGES.length) return 'APPROVED'
  return BILL_STAGES[stage].status
}

export function statusLabel(status) {
  return BILL_STATUS[status] || status
}

// 是否为待确认（未终态）
export function isPending(bill) {
  return bill.status !== 'APPROVED' && bill.status !== 'REJECTED'
}

// 该用户当前是否轮到确认本单（多角色账号命中任一即可）
export function isMyTurn(user, bill) {
  const stage = currentStage(bill)
  if (!stage || !hasRole(user, stage.roleType)) return false
  // 第一环节（工程师确认）由财务指定具体工程师：只有被指派的人算轮到自己，
  // 否则改派后「原工程师」和「新工程师」会同时显示可确认
  if (stage.key === 'BIZ') return !!bill.assigneeId && Number(bill.assigneeId) === Number(user.id)
  return true
}

// 供应商身份以「姓名」为口径：单据 supplierName ↔ 账号 userName（不再用归属供应商 id）
export function supplierNameOfUser(user) {
  return String(user?.userName || '').trim()
}

export function sameSupplier(bill, user) {
  const mine = supplierNameOfUser(user)
  return !!mine && String(bill?.supplierName || '').trim() === mine
}

// 供应商数据隔离：越权返回 403
export function assertSupplierVisible(user, bill) {
  if (isSupplierOnly(user) && !sameSupplier(bill, user)) {
    throw new ApiError(403, 'SUPPLIER_DATA_FORBIDDEN', '无权访问其他供应商的结算单')
  }
}

// 内部角色：持其中任一即按内部人员放行（可见全部）
export const INTERNAL_ROLES = [ROLE.CLIENT_PM, 13, 14, 15, 16]

// 数据范围是否"仅本供应商"：只有纯供应商账号受限。
// 统一结算方(17)需要拿到其他供应商提交的结算单与附件做金额对比，因此按"全量只读"处理
// （他仍只能在自己那一环确认，节点角色校验照旧）。
export function isSupplierOnly(user) {
  const owned = roleTypesOf(user)
  if (!owned.length) return false
  if (owned.some(r => INTERNAL_ROLES.includes(r))) return false
  if (owned.includes(ROLE.SETTLEMENT)) return false
  return owned.includes(ROLE.VENDOR_TL)
}

// 校验一次确认动作是否合法，并返回本次要推进到的阶段索引
export function assertConfirmable(user, bill) {
  if (bill.status === 'APPROVED') throw new ApiError(409, 'BILL_ALREADY_APPROVED', '该结算单已全部确认通过')
  if (bill.status === 'REJECTED') throw new ApiError(409, 'BILL_ALREADY_REJECTED', '该结算单已被驳回，需供应商重新提交')
  const stage = currentStage(bill)
  if (!hasRole(user, stage.roleType)) {
    // 不是本节点：先按数据范围拦截（供应商受限账号会得到更明确的 403）
    assertSupplierVisible(user, bill)
    throw new ApiError(403, 'FORBIDDEN', `当前处于「${stage.label}」节点，您不是该节点的确认人`)
  }
  // 轮到本人节点：不再按供应商口径隔离
  // （统一结算方需要处理各供应商停在统结方节点的单据）
  // 返回归一后的下标：免统结供应商的历史单据若停在统结环节，会自动落到下一个适用环节
  return currentStageIndex(bill)
}

// 是否可代建/管理（供应商或甲方PM）
export function canOriginate(user) {
  return hasAnyRole(user, [ROLE.VENDOR_TL, ROLE.CLIENT_PM])
}
