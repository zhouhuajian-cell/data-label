// GND 入库服务：入库判断 / 人工处理通过
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndWarehouseRecords } from '../repositories/data.js'
import { assertTransition } from '../lib/gnd-state-machine.js'
import { nextId, gndEnsureTaskVisible, writeStatusHistory, writeAudit, notifyGnd } from './gnd-common.js'

const TAIXING_ADMIN = 8
const SUPPLIER = 12

function requireAdmin(user) {
  if (user.roleType !== TAIXING_ADMIN) throw new ApiError(403, 'FORBIDDEN', '仅泰兴管理员可操作')
}

function writeWarehouse(task, user, result, remark) {
  gndWarehouseRecords.push({
    id: nextId(gndWarehouseRecords),
    taskId: task.id,
    round: task.repairRound,
    result,
    warehousedAt: result === 'QUALIFIED' ? nowText() : null,
    remark: String(remark || '').trim(),
    operatorId: user.id
  })
}

// ===== 入库判断（泰兴管理员 8）：ACCEPTED → WAREHOUSED / WAREHOUSE_REJECTED =====
export function warehouse(user, taskId, body) {
  requireAdmin(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'warehouse', user)
  const result = String(body.result || '').toUpperCase()
  if (!['QUALIFIED', 'UNQUALIFIED'].includes(result)) throw new ApiError(422, 'VALIDATION_ERROR', 'result 必须为 QUALIFIED 或 UNQUALIFIED')
  const from = task.status
  writeWarehouse(task, user, result, body.remark)
  if (result === 'QUALIFIED') {
    task.status = 'WAREHOUSED'
    task.warehousedAt = nowText()
  } else {
    task.status = 'WAREHOUSE_REJECTED'
  }
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, task.status, result === 'QUALIFIED' ? '合格入库' : '入库不合格，需人工处理')
  writeAudit(user, 'gnd.task.warehouse', task.id, { result })
  if (result === 'QUALIFIED') notifyGnd([11], 'GND 已入库', `测区「${task.measurementAreaName}」已入库，可查看使用`, task.id)
  return task
}

// ===== 人工处理通过（泰兴管理员 8）：WAREHOUSE_REJECTED → WAREHOUSED =====
export function warehouseRecover(user, taskId, body) {
  requireAdmin(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'warehouse_recover', user)
  const from = task.status
  writeWarehouse(task, user, 'QUALIFIED', String(body.remark || '人工处理通过').trim())
  task.status = 'WAREHOUSED'
  task.warehousedAt = nowText()
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'WAREHOUSED', '入库不合格人工处理通过')
  writeAudit(user, 'gnd.task.warehouseRecover', task.id)
  notifyGnd([11], 'GND 已入库', `测区「${task.measurementAreaName}」人工处理通过，已入库`, task.id)
  return task
}
