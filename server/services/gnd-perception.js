// GND 感知服务：使用状态 / 返修申请 / 撤回返修
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndPerceptions, gndSubmissions } from '../repositories/data.js'
import { assertTransition } from '../lib/gnd-state-machine.js'
import { nextId, gndEnsureTaskVisible, writeStatusHistory, writeFieldHistory, writeAudit, notifyGnd } from './gnd-common.js'

const TAIXING_ADMIN = 8
const PERCEPTION = 11
const SUPPLIER = 12

const USAGE = ['UNUSED', 'IN_USE', 'USED']

function requirePerception(user) {
  if (user.roleType !== PERCEPTION) throw new ApiError(403, 'FORBIDDEN', '仅感知团队可操作')
}

function getOrCreatePerception(taskId) {
  let p = gndPerceptions.find(x => x.taskId === taskId)
  if (!p) {
    p = { id: nextId(gndPerceptions), taskId, usageStatus: 'UNUSED', repairRequired: false, repairReason: null, updatedAt: nowText() }
    gndPerceptions.push(p)
  }
  return p
}

// ===== 更新使用状态（感知团队 11）=====
export function updatePerception(user, taskId, body) {
  requirePerception(user)
  const task = gndEnsureTaskVisible(user, taskId)
  if (task.status !== 'WAREHOUSED') throw new ApiError(409, 'TASK_INVALID_STATUS', '仅已入库任务可更新使用状态')
  const usage = String(body.usageStatus || '').toUpperCase()
  if (!USAGE.includes(usage)) throw new ApiError(422, 'VALIDATION_ERROR', 'usageStatus 必须为 UNUSED/IN_USE/USED')
  const p = getOrCreatePerception(taskId)
  writeFieldHistory(task, user, 'usageStatus', p.usageStatus, usage)
  p.usageStatus = usage
  p.updatedBy = user.id
  p.updatedAt = nowText()
  writeAudit(user, 'gnd.task.perception', task.id, { usage })
  return p
}

// ===== 感知返修申请（感知团队 11）：WAREHOUSED → REPAIR_REQUIRED =====
export function repair(user, taskId, body) {
  requirePerception(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'repair', user)
  const reason = String(body.repairReason || '').trim()
  if (!reason) throw new ApiError(422, 'REPAIR_REASON_REQUIRED', '返修原因必填')
  const p = getOrCreatePerception(taskId)
  writeFieldHistory(task, user, 'repairReason', p.repairReason || '', reason)
  p.repairRequired = true
  p.repairReason = reason
  p.updatedBy = user.id
  p.updatedAt = nowText()
  const from = task.status
  task.status = 'REPAIR_REQUIRED'
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'REPAIR_REQUIRED', reason)
  writeAudit(user, 'gnd.task.repair', task.id, { reason })
  notifyGnd([TAIXING_ADMIN, SUPPLIER], 'GND 返修申请', `测区「${task.measurementAreaName}」申请返修：${reason}`, task.id)
  return task
}

// ===== 撤回返修（感知团队 11）：REPAIR_REQUIRED → WAREHOUSED =====
export function repairCancel(user, taskId) {
  requirePerception(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'repair_cancel', user)
  const resubmitted = gndSubmissions.some(s => s.taskId === task.id && s.round > task.repairRound)
  if (resubmitted) throw new ApiError(409, 'TASK_INVALID_STATUS', '供应商已重新提交成果，无法撤回返修')
  const p = getOrCreatePerception(taskId)
  p.repairRequired = false
  p.updatedBy = user.id
  p.updatedAt = nowText()
  const from = task.status
  task.status = 'WAREHOUSED'
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'WAREHOUSED', '感知撤回返修申请')
  writeAudit(user, 'gnd.task.repairCancel', task.id)
  return task
}
