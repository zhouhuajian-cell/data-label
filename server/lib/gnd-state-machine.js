// GND 域状态机（后端唯一权威，禁止前端直接修改 task.status）
// 设计依据：docs/GND-改造设计.md 第 3 章
import { ApiError } from './http.js'

export const GND_STATUS = {
  WAITING_ANNOTATION: 'WAITING_ANNOTATION', // 待供应商接收
  PROCESSING: 'PROCESSING',                 // 供应商处理中（平台不跟踪内部状态）
  WAITING_OPTIMIZATION: 'WAITING_OPTIMIZATION', // 待优化
  OPTIMIZING: 'OPTIMIZING',                 // 优化中
  WAITING_ACCEPTANCE: 'WAITING_ACCEPTANCE', // 待验收
  ACCEPTED: 'ACCEPTED',                     // 验收通过
  REJECTED: 'REJECTED',                     // 驳回返修
  WAREHOUSED: 'WAREHOUSED',                 // 已入库
  WAREHOUSE_REJECTED: 'WAREHOUSE_REJECTED', // 入库不合格
  REPAIR_REQUIRED: 'REPAIR_REQUIRED',       // 需返修
  VOIDED: 'VOIDED'                          // 已作废
}

export const GND_STATE_CN = {
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

// 状态转移表：action -> { from, to(null=由业务层决定), roles, supplierScope }
export const GND_TRANSITIONS = {
  receive: { from: ['WAITING_ANNOTATION'], to: 'PROCESSING', roles: [12], supplierScope: true },
  void_task: { from: ['WAITING_ANNOTATION'], to: 'VOIDED', roles: [8] },
  submit: { from: ['PROCESSING', 'REJECTED', 'REPAIR_REQUIRED'], to: 'WAITING_OPTIMIZATION', roles: [12], supplierScope: true },
  submit_cancel: { from: ['WAITING_OPTIMIZATION'], to: 'PROCESSING', roles: [12], supplierScope: true },
  optimization_start: { from: ['WAITING_OPTIMIZATION'], to: 'OPTIMIZING', roles: [9] },
  optimization_skip: { from: ['WAITING_OPTIMIZATION'], to: 'WAITING_ACCEPTANCE', roles: [9] },
  optimization_complete: { from: ['OPTIMIZING'], to: 'WAITING_ACCEPTANCE', roles: [9] },
  acceptance: { from: ['WAITING_ACCEPTANCE'], to: null, roles: [10] },
  acceptance_revert: { from: ['ACCEPTED'], to: 'WAITING_ACCEPTANCE', roles: [8] },
  warehouse: { from: ['ACCEPTED'], to: null, roles: [8] },
  warehouse_recover: { from: ['WAREHOUSE_REJECTED'], to: 'WAREHOUSED', roles: [8] },
  repair: { from: ['WAREHOUSED'], to: 'REPAIR_REQUIRED', roles: [11] },
  repair_cancel: { from: ['REPAIR_REQUIRED'], to: 'WAREHOUSED', roles: [11] }
}

/**
 * 校验一次状态转移是否合法（角色 + 数据范围 + 当前状态）。
 * @returns 转移定义
 * @throws ApiError(403/409)
 */
export function assertTransition(task, action, user) {
  const trans = GND_TRANSITIONS[action]
  if (!trans) throw new ApiError(422, 'VALIDATION_ERROR', '未知的状态机动作：' + action)
  if (!trans.roles.includes(user.roleType)) {
    throw new ApiError(403, 'FORBIDDEN', '当前角色无权执行该操作')
  }
  if (trans.supplierScope && task.supplierId !== user.supplierId) {
    throw new ApiError(403, 'SUPPLIER_DATA_FORBIDDEN', '无权操作其他供应商的任务')
  }
  if (!trans.from.includes(task.status)) {
    throw new ApiError(409, 'TASK_INVALID_STATUS',
      `当前状态「${GND_STATE_CN[task.status] || task.status}」不允许执行该操作`)
  }
  return trans
}

/** 判断指定动作的目标状态（to=null 时由业务层传入） */
export function nextStatus(trans, decided) {
  return trans.to || decided
}
