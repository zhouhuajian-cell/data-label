// GND 供应商交付服务：接收任务 / 提交成果 / 撤回提交
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndSubmissions, gndOptimizations } from '../repositories/data.js'
import { isOptionValid } from '../lib/gnd-options.js'
import { assertTransition } from '../lib/gnd-state-machine.js'
import { nextId, gndEnsureTaskVisible, writeStatusHistory, writeFieldHistory, writeAudit, currentSubmission, notifyGnd } from './gnd-common.js'

const TAIXING_ADMIN = 8
const SUPPLIER = 12

// ===== 接收任务（供应商 12）：WAITING_ANNOTATION → PROCESSING =====
export function receiveTask(user, taskId) {
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'receive', user)
  const from = task.status
  task.status = 'PROCESSING'
  task.receivedAt = nowText()
  task.updatedAt = nowText()
  task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'PROCESSING', '供应商接收任务')
  writeAudit(user, 'gnd.task.receive', task.id)
  notifyGnd([TAIXING_ADMIN], 'GND 任务已接收', `测区「${task.measurementAreaName}」供应商已接收`, task.id)
  return task
}

// ===== 提交成果（供应商 12）：PROCESSING/REJECTED/REPAIR_REQUIRED → WAITING_OPTIMIZATION =====
export function submitTask(user, taskId, body) {
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'submit', user)
  const mileage = Number(body.supplierMileage)
  const roadScene = String(body.supplierRoadScene || '').trim()
  if (!Number.isFinite(mileage) || mileage <= 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'supplierMileage 必须大于 0')
  }
  if (!roadScene || !isOptionValid('ROAD_SCENE', roadScene)) {
    throw new ApiError(422, 'ROAD_SCENE_INVALID', 'supplierRoadScene 必填且为合法道路场景')
  }

  const isRework = task.status === 'REJECTED' || task.status === 'REPAIR_REQUIRED'
  if (isRework) task.repairRound += 1

  const from = task.status
  gndSubmissions.push({
    id: nextId(gndSubmissions),
    taskId: task.id,
    round: task.repairRound,
    supplierMileage: mileage,
    supplierRoadScene: roadScene,
    remark: String(body.remark || '').trim(),
    submittedAt: nowText(),
    submittedBy: user.id
  })

  // 道路场景与上一轮/初填差异留痕
  const prev = currentSubmission(task)
  const baseline = prev ? prev.supplierRoadScene : task.initialRoadScene
  if (roadScene !== baseline) {
    writeFieldHistory(task, user, 'supplierRoadScene', baseline, roadScene)
  }

  task.status = 'WAITING_OPTIMIZATION'
  task.submittedAt = nowText()
  task.updatedAt = nowText()
  task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'WAITING_OPTIMIZATION', isRework ? `第 ${task.repairRound} 轮重新交付` : '供应商提交成果')
  writeAudit(user, 'gnd.task.submit', task.id, { round: task.repairRound, mileage })
  notifyGnd([TAIXING_ADMIN, 9], 'GND 成果已提交', `测区「${task.measurementAreaName}」第 ${task.repairRound + 1} 轮成果已提交`, task.id)
  return task
}

// ===== 撤回提交（供应商 12）：WAITING_OPTIMIZATION → PROCESSING =====
export function cancelSubmit(user, taskId) {
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'submit_cancel', user)
  const hasOptimization = gndOptimizations.some(o => o.taskId === task.id && o.round === task.repairRound)
  if (hasOptimization) {
    throw new ApiError(409, 'TASK_INVALID_STATUS', '优化员已开始优化，无法撤回提交')
  }
  const from = task.status
  task.status = 'PROCESSING'
  task.updatedAt = nowText()
  task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'PROCESSING', '供应商撤回提交成果')
  writeAudit(user, 'gnd.task.submitCancel', task.id)
  return task
}
