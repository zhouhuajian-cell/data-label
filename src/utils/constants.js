export const TASK_STATE_MAP = {
  DRAFT: '草稿',
  UNASSIGNED: '待指派',
  ANNOTATING: '标注中',
  VENDOR_QA: '供应商质检',
  CLIENT_QA: '甲方质检',
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

export const ROLE_TYPE = {
  CLIENT_PM: 1,
  CLIENT_QA: 2,
  VENDOR_TL: 3,
  ANNOTATOR: 4,
  ALGO_ENG: 6
}

export const ROLE_LABELS = {
  1: '甲方项目经理',
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
