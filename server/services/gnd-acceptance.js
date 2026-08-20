// GND 验收服务：验收（通过/驳回）/ 撤销验收
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndAcceptances, gndWarehouseRecords } from '../repositories/data.js'
import { isOptionValid } from '../lib/gnd-options.js'
import { assertTransition } from '../lib/gnd-state-machine.js'
import { nextId, gndEnsureTaskVisible, writeStatusHistory, writeAudit, currentSubmission, notifyGnd } from './gnd-common.js'

const TAIXING_ADMIN = 8
const ACCEPTOR = 10
const OPTIMIZER = 9
const SUPPLIER = 12

const DIFFERENCE_THRESHOLD = 0.05 // 5%，可经 gndOptions 调整（当前为默认值）

function requireAcceptor(user) {
  if (user.roleType !== ACCEPTOR) throw new ApiError(403, 'FORBIDDEN', '仅验收员可操作')
}

// ===== 验收（验收员 10）：WAITING_ACCEPTANCE → ACCEPTED / REJECTED =====
export function acceptance(user, taskId, body) {
  requireAcceptor(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'acceptance', user)
  const mileage = Number(body.acceptanceMileage)
  const roadScene = String(body.acceptanceRoadScene || '').trim()
  const result = String(body.result || '').toUpperCase()
  if (!Number.isFinite(mileage) || mileage <= 0) throw new ApiError(422, 'VALIDATION_ERROR', 'acceptanceMileage 必须大于 0')
  if (!roadScene || !isOptionValid('ROAD_SCENE', roadScene)) throw new ApiError(422, 'ROAD_SCENE_INVALID', 'acceptanceRoadScene 必填且为合法道路场景')
  if (!['PASSED', 'REJECTED'].includes(result)) throw new ApiError(422, 'VALIDATION_ERROR', 'result 必须为 PASSED 或 REJECTED')

  const sub = currentSubmission(task)
  const supplierMileage = sub ? sub.supplierMileage : 0

  if (result === 'REJECTED') {
    if (!String(body.rejectReason || '').trim()) throw new ApiError(422, 'REJECT_REASON_REQUIRED', '驳回返修时驳回原因必填')
  } else {
    const diffRate = supplierMileage > 0 ? Math.abs(mileage - supplierMileage) / supplierMileage : 0
    if (supplierMileage > 0 && diffRate > DIFFERENCE_THRESHOLD && !String(body.differenceExplanation || '').trim()) {
      throw new ApiError(422, 'MILEAGE_DIFFERENCE_REQUIRES_EXPLANATION', `里程差异 ${(diffRate * 100).toFixed(1)}% 超过阈值，请填写差异说明`)
    }
  }

  const from = task.status
  const isRework = from === 'REJECTED'
  gndAcceptances.push({
    id: nextId(gndAcceptances),
    taskId: task.id,
    round: task.repairRound,
    acceptanceMileage: mileage,
    acceptanceRoadScene: roadScene,
    result,
    rejectReason: result === 'REJECTED' ? String(body.rejectReason).trim() : null,
    differenceExplanation: result === 'PASSED' ? String(body.differenceExplanation || '').trim() || null : null,
    differenceRate: result === 'PASSED' && supplierMileage > 0 ? Number((Math.abs(mileage - supplierMileage) / supplierMileage).toFixed(4)) : null,
    operatedAt: nowText(),
    operatorId: user.id
  })

  if (result === 'PASSED') {
    task.status = 'ACCEPTED'
    task.acceptedAt = nowText()
  } else {
    task.status = 'REJECTED'
  }
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, task.status, result === 'PASSED' ? '验收通过' : '驳回返修')
  writeAudit(user, 'gnd.task.acceptance', task.id, { result, mileage, round: task.repairRound })
  if (result === 'REJECTED') notifyGnd([SUPPLIER], 'GND 验收驳回', `测区「${task.measurementAreaName}」被驳回：${body.rejectReason}`, task.id)
  else notifyGnd([TAIXING_ADMIN], 'GND 验收通过', `测区「${task.measurementAreaName}」验收通过，待入库`, task.id)
  return task
}

// ===== 撤销验收（泰兴管理员 8）：ACCEPTED → WAITING_ACCEPTANCE（仅未入库前）=====
export function revertAcceptance(user, taskId, body) {
  if (user.roleType !== TAIXING_ADMIN) throw new ApiError(403, 'FORBIDDEN', '仅泰兴管理员可操作')
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'acceptance_revert', user)
  const reason = String(body.reason || '').trim()
  if (!reason) throw new ApiError(422, 'VALIDATION_ERROR', '撤销原因必填')
  if (gndWarehouseRecords.some(w => w.taskId === task.id)) {
    throw new ApiError(409, 'TASK_INVALID_STATUS', '已入库任务不可撤销验收')
  }
  const from = task.status
  task.status = 'WAITING_ACCEPTANCE'
  task.acceptedAt = null
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'WAITING_ACCEPTANCE', '撤销验收：' + reason)
  writeAudit(user, 'gnd.task.acceptanceRevert', task.id, { reason })
  return task
}
