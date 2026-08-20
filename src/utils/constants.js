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

export const ROLE_TYPE = {
  CLIENT_PM: 1,
  CLIENT_QA: 2,
  VENDOR_TL: 3,
  ANNOTATOR: 4,
  ALGO_ENG: 6,
  DATA_CLEANER: 7
}

export const ROLE_LABELS = {
  1: '泰兴管理员',
  2: '甲方质检员',
  3: '供应商团队长（含质检）',
  4: '标注员',
  6: '算法工程师',
  7: '数据清洗人员'
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
