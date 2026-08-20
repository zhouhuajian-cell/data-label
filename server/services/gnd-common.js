// GND 域公共工具：数据范围校验、历史/审计/通知写入
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import {
  gndTasks, gndSubmissions, gndStatusHistory, gndFieldHistory,
  auditLogs, gndSuppliers
} from '../repositories/data.js'
import { notifyByRole } from './notifications.js'

export function nextId(arr) {
  return Math.max(0, ...arr.map(x => x.id)) + 1
}

/** 数据范围校验：供应商(12)仅本 supplierId；感知(11)仅已入库；泰兴(8/9/10)全量 */
export function gndEnsureTaskVisible(user, taskId) {
  const task = gndTasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  if (user.roleType === 12 && task.supplierId !== user.supplierId) {
    throw new ApiError(403, 'SUPPLIER_DATA_FORBIDDEN', '无权访问其他供应商的任务')
  }
  if (user.roleType === 11 && task.status !== 'WAREHOUSED') {
    throw new ApiError(403, 'SUPPLIER_DATA_FORBIDDEN', '感知团队仅可访问已入库任务')
  }
  return task
}

export function writeStatusHistory(task, user, from, to, remark = '') {
  gndStatusHistory.push({
    id: nextId(gndStatusHistory),
    taskId: task.id,
    fromStatus: from,
    toStatus: to,
    operatorId: user.id,
    operatorRole: user.roleType,
    round: task.repairRound,
    remark,
    createdAt: nowText()
  })
}

export function writeFieldHistory(task, user, fieldName, oldValue, newValue) {
  if (oldValue === newValue) return
  gndFieldHistory.push({
    id: nextId(gndFieldHistory),
    taskId: task.id,
    fieldName,
    oldValue: oldValue == null ? '' : String(oldValue),
    newValue: newValue == null ? '' : String(newValue),
    operatorId: user.id,
    operatorRole: user.roleType,
    round: task.repairRound,
    createdAt: nowText()
  })
}

export function writeAudit(user, action, taskId = null, extra = {}) {
  auditLogs.push({ action, actorId: user.id, taskId, at: nowText(), ...extra })
}

/** 当前轮供应商交付记录（最新 round） */
export function currentSubmission(task) {
  const list = gndSubmissions.filter(s => s.taskId === task.id)
  return list.length ? list.sort((a, b) => a.round - b.round)[list.length - 1] : null
}

export function supplierName(supplierId) {
  const s = gndSuppliers.find(x => x.id === supplierId)
  return s ? s.name : ''
}

/** 站内通知（不影响主事务，失败吞掉） */
export function notifyGnd(roles, title, content, taskId = null) {
  try { notifyByRole(null, roles, 'gnd', title, content, 'task', taskId) } catch { /* 通知失败不阻塞主流程 */ }
}
