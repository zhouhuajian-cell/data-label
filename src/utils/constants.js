export const TASK_STATE_MAP = {
  DRAFT: '草稿',
  UNASSIGNED: '待标注',
  ANNOTATING: '标注中',
  VENDOR_QA: '供应商质检',
  CLIENT_QA: '已提交待甲方验收',
  ALGO_CHECK: '算法抽检',
  ACCEPTED: '已验收',
  REJECTED: '驳回整改',
  ARCHIVED: '已归档'
}

export const TASK_STATE_TYPE_MAP = {
  DRAFT: 'info',
  UNASSIGNED: 'warning',
  ANNOTATING: '',
  VENDOR_QA: 'warning',
  CLIENT_QA: '',
  ALGO_CHECK: '',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  ARCHIVED: 'info'
}

export const ITEM_STATUS_MAP = {
  pending: '待标注', annotating: '标注中', annotated: '待供应商质检',
  submitted: '已提交', vendor_passed: '待甲方质检', accepted: '已验收',
  rework: '返工中', rejected: '返工中', failed: '失败'
}

export const ANNOTATE_TYPES = ['2D拉框', '3D点云标注', '语义分割', '车道线标注', 'Vslam', '数据闭环', 'CNN', 'AEB', 'OBJ']

// 成本中心备选（结算单里可下拉选择，也可现场输入新增）
export const COST_CENTER_OPTIONS = ['端到端项目', '端到端小车项目', 'M57项目', 'overseas项目', 'G91项目', '商用车项目']

export const ROLE_TYPE = {
  CLIENT_PM: 1,
  CLIENT_QA: 2,
  VENDOR_TL: 3,
  ANNOTATOR: 4,
  ALGO_ENG: 6,
  DATA_CLEANER: 7,
  // 验收结算确认流四级确认人（角色号 13-16，与 server/lib/bill-flow.js 保持一致）
  BIZ_ENGINEER: 13,
  FINANCE: 14,
  LEADER: 15,
  PERCEPTION: 16,
  SETTLEMENT: 17,
  OA_SETTLEMENT: 18
}

export const ROLE_LABELS = {
  1: '管理员',
  2: '甲方质检员',
  3: '供应商',
  4: '标注员',
  6: '算法工程师',
  7: '数据清洗人员',
  13: '业务工程师',
  14: '财务',
  15: '负责人',
  16: '感知工程师',
  17: '统一结算方',
  18: 'OA结算专员'
}

// ===== 模块开关 =====
// DATA_MODULE：数据生产域（数据管理中心 / 任务管理 / 标注工作台 / 质检）
// 暂时关闭，平台聚焦"已验收数据的后续财务确认节点"；恢复时改为 true 即可。
export const FEATURES = {
  DATA_MODULE: false
}

// ===== 验收结算确认流 =====
// 顺序即确认顺序：供应商上传 → 业务工程师 → 财务端 → 负责人 → 感知工程师
export const BILL_STAGES = [
  { key: 'BIZ', label: '工程师确认', short: '工程师', roleType: ROLE_TYPE.BIZ_ENGINEER },
  { key: 'FINANCE', label: '财务确认', short: '财务', roleType: ROLE_TYPE.FINANCE },
  { key: 'SETTLEMENT', label: '统结方提交', short: '统结方', roleType: ROLE_TYPE.SETTLEMENT },
  { key: 'FINANCE2', label: '财务二次确认', short: '财务二次', roleType: ROLE_TYPE.FINANCE },
  { key: 'LEADER', label: '负责人确认', short: '负责人', roleType: ROLE_TYPE.LEADER },
  { key: 'PERCEPTION', label: '算法确认', short: '算法', roleType: ROLE_TYPE.PERCEPTION },
  { key: 'OA', label: 'OA结算确认', short: 'OA', roleType: ROLE_TYPE.OA_SETTLEMENT }
]

export const BILL_STATUS_MAP = {
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

export const BILL_STATUS_TYPE_MAP = {
  PENDING_BIZ: 'warning',
  PENDING_FINANCE: 'warning',
  PENDING_SETTLEMENT: 'warning',
  PENDING_FINANCE2: 'warning',
  PENDING_LEADER: 'warning',
  PENDING_PERCEPTION: 'warning',
  PENDING_OA: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger'
}

// 确认链角色（可作为确认人）；供应商与甲方PM为发起方，不参与确认
export const BILL_CONFIRM_ROLES = BILL_STAGES.map(s => s.roleType)
export const BILL_ALL_ROLES = [ROLE_TYPE.CLIENT_PM, ROLE_TYPE.VENDOR_TL, ROLE_TYPE.OA_SETTLEMENT, ...BILL_CONFIRM_ROLES]

// 环节顺序 → 对应的"待确认"状态码，用于按环节统计/筛选（与后端 BILL_STAGES.status 一致）
export const BILL_STATUS_BY_STAGE = ['PENDING_BIZ', 'PENDING_FINANCE', 'PENDING_SETTLEMENT', 'PENDING_FINANCE2', 'PENDING_LEADER', 'PENDING_PERCEPTION', 'PENDING_OA']

// 当前用户是否为确认链中的节点（用于决定是否显示"待我确认"）
export function stageByRole(roleType) {
  return BILL_STAGES.find(s => s.roleType === roleType) || null
}

export function getBillStatusText(status) { return BILL_STATUS_MAP[status] || status }
export function getBillStatusType(status) { return BILL_STATUS_TYPE_MAP[status] || 'info' }

// ===== 多角色 =====
// 账号可持多个角色（roleTypes），roleType 为主角色（= roleTypes[0]）
// 与 server/lib/roles.js 保持同一口径
export const ALL_ROLES = [1, 2, 3, 4, 6, 7, 13, 14, 15, 16, 17, 18]

export function roleTypesOf(userOrRole) {
  if (userOrRole === null || userOrRole === undefined) return []
  // 兼容直接传角色号
  if (typeof userOrRole === 'number') return ALL_ROLES.includes(userOrRole) ? [userOrRole] : []
  const list = Array.isArray(userOrRole.roleTypes) ? userOrRole.roleTypes.filter(r => ALL_ROLES.includes(Number(r))) : []
  const merged = [...new Set(list.map(Number))]
  const primary = ALL_ROLES.includes(Number(userOrRole.roleType)) ? Number(userOrRole.roleType) : null
  if (primary === null) return merged
  return [primary, ...merged.filter(r => r !== primary)]
}

export function hasRole(userOrRole, role) {
  return roleTypesOf(userOrRole).includes(Number(role))
}

export function hasAnyRole(userOrRole, roles) {
  const owned = roleTypesOf(userOrRole)
  return roles.some(r => owned.includes(Number(r)))
}

export function roleLabelsOf(userOrRole) {
  return roleTypesOf(userOrRole).map(r => ROLE_LABELS[r] || `角色${r}`)
}

// 该账号在确认链上可操作的节点（0/1/多个）
export function stagesOf(userOrRole) {
  const owned = roleTypesOf(userOrRole)
  return BILL_STAGES.filter(s => owned.includes(s.roleType))
}

// 金额显示：至少 2 位小数；数值本身有多余精度时最多展示 10 位（去掉末尾 0），
// 与后端 10 位小数口径一致（见 server/lib/money.js）
export function formatMoney(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0.00'
  const trimmed = n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  const decLen = String(trimmed).split('.')[1]?.length || 0
  const digits = Math.min(10, Math.max(2, decLen))
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

// 纯供应商账号（只持供应商角色）：工作台就是「项目管理」（建项目 + 上传验收数据）
export function isSupplierOnly(userOrRole) {
  const roles = roleTypesOf(userOrRole)
  return roles.length > 0 && roles.every(r => r === ROLE_TYPE.VENDOR_TL)
}

// 是否可访问「验收结算确认」页：确认链角色与甲方PM可访问；纯供应商只在项目页内看本项目的结算单
export function canAccessBills(userOrRole) {
  if (isSupplierOnly(userOrRole)) return false
  return hasAnyRole(userOrRole, BILL_ALL_ROLES)
}

// 登录后落地页（登录页与路由守卫共用同一口径）
export function defaultHomePath(userOrRole) {
  const roles = roleTypesOf(userOrRole)
  // 数据生产模块关闭时：结算总览与确认工作台已合并为「验收结算确认」单页
  if (!FEATURES.DATA_MODULE) {
    if (isSupplierOnly(userOrRole)) return '/supplier/projects'
    // 财务的工作台是「财务结算」（逐单核算），其余结算角色落在「验收结算确认」
    if (hasRole(userOrRole, ROLE_TYPE.FINANCE)) return '/finance/settlement'
    if (canAccessBills(userOrRole)) return '/finance/bills'
    // 既无结算角色、数据生产域又隐藏 → 只剩消息中心可访问
    return '/message'
  }
  if (roles.includes(ROLE_TYPE.ANNOTATOR)) return '/task'
  if (roles.includes(ROLE_TYPE.CLIENT_QA)) return '/qa'
  if (roles.includes(ROLE_TYPE.VENDOR_TL)) return '/supplier/dashboard'
  if (roles.includes(ROLE_TYPE.ALGO_ENG) || roles.includes(ROLE_TYPE.DATA_CLEANER)) return '/dataset'
  return '/dashboard'
}

// 数据生产域路由前缀：FEATURES.DATA_MODULE 关闭时整段不可访问
// 注意：/supplier/projects（项目管理）保留可用——结算是以项目为导向的
export const DATA_MODULE_PATHS = [
  '/dataset', '/task', '/qa',
  '/supplier/dashboard', '/supplier/performance',
  '/finance/bill'
]

export function isHiddenByDataModule(path) {
  if (FEATURES.DATA_MODULE) return false
  return DATA_MODULE_PATHS.some(p => path === p || path.startsWith(p + '/'))
}



export const REJECT_ERROR_TYPES = [
  { label: '标框不准', value: 'bbox_inaccurate' },
  { label: '漏标', value: 'missing_label' },
  { label: '标签选择错误', value: 'wrong_label' },
  { label: '属性遗漏', value: 'missing_attribute' },
  { label: '格式错误', value: 'format_error' },
  { label: '文档缺失', value: 'missing_doc' },
  { label: '合规问题', value: 'compliance' },
  { label: '其他', value: 'other' }
]

export function getTaskStateText(code) { return TASK_STATE_MAP[code] || code }
export function getTaskStateType(code) { return TASK_STATE_TYPE_MAP[code] || '' }

export function calcWarningLevel(deadline) {
  if (!deadline) return null
  const now = Date.now()
  const dl = new Date(deadline.replace(/-/g, '/')).getTime()
  if (isNaN(dl)) return null
  const diff = dl - now
  if (diff <= 0) return { level: 3, label: '已逾期', color: 'danger' }
  if (diff <= 6 * 60 * 60 * 1000) return { level: 2, label: '即将超时', color: 'warning' }
  if (diff <= 24 * 60 * 60 * 1000) return { level: 1, label: '临近截止', color: '' }
  return null
}

// ===== GND 域（泰兴量产数据交互平台）=====
export const GND_ROLE_TYPE = {
  TAIXING_ADMIN: 8,
  OPTIMIZER: 9,
  ACCEPTOR: 10,
  PERCEPTION: 11,
  SUPPLIER: 12
}

export const GND_ROLE_LABELS = {
  1: '管理员',
  8: '泰兴管理员',
  9: '优化员',
  10: '验收员',
  11: '感知团队',
  12: '供应商交付员'
}

export const GND_STATUS_MAP = {
  WAITING_ANNOTATION: '待供应商接收',
  PROCESSING: '供应商处理中',
  WAITING_OPTIMIZATION: '待优化',
  OPTIMIZING: '优化中',
  WAITING_ACCEPTANCE: '待验收',
  ACCEPTED: '验收通过',
  REJECTED: '驳回返修',
  WAREHOUSED: '已入库',
  WAREHOUSE_REJECTED: '入库不合格',
  REPAIR_REQUIRED: '需返修',
  VOIDED: '已作废'
}

export const GND_STATUS_TYPE = {
  WAITING_ANNOTATION: 'info',
  PROCESSING: 'warning',
  WAITING_OPTIMIZATION: 'warning',
  OPTIMIZING: 'warning',
  WAITING_ACCEPTANCE: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WAREHOUSED: 'success',
  WAREHOUSE_REJECTED: 'danger',
  REPAIR_REQUIRED: 'danger',
  VOIDED: 'info'
}
