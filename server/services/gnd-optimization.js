// GND 优化服务：开始优化 / 无需优化 / 优化完成
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndOptimizations } from '../repositories/data.js'
import { assertTransition } from '../lib/gnd-state-machine.js'
import { nextId, gndEnsureTaskVisible, writeStatusHistory, writeAudit, notifyGnd } from './gnd-common.js'

const TAIXING_ADMIN = 8
const OPTIMIZER = 9

function requireOptimizer(user) {
  if (user.roleType !== OPTIMIZER) throw new ApiError(403, 'FORBIDDEN', '仅优化员可操作')
}

function writeOptimization(task, user, data) {
  gndOptimizations.push({
    id: nextId(gndOptimizations),
    taskId: task.id,
    round: task.repairRound,
    ...data,
    operatorId: user.id
  })
}

export function startOptimization(user, taskId, body) {
  requireOptimizer(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'optimization_start', user)
  const from = task.status
  writeOptimization(task, user, {
    needOptimization: true,
    method: String(body.method || 'script_single_package').trim(),
    completedAt: null,
    remark: String(body.remark || '').trim()
  })
  task.status = 'OPTIMIZING'
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'OPTIMIZING', '开始 pose 语义优化')
  writeAudit(user, 'gnd.task.optimizationStart', task.id)
  return task
}

export function skipOptimization(user, taskId, body) {
  requireOptimizer(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'optimization_skip', user)
  const from = task.status
  writeOptimization(task, user, {
    needOptimization: false,
    method: '',
    completedAt: nowText(),
    remark: String(body.remark || '').trim()
  })
  task.status = 'WAITING_ACCEPTANCE'
  task.optimizationCompletedAt = nowText()
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'WAITING_ACCEPTANCE', '无需优化')
  writeAudit(user, 'gnd.task.optimizationSkip', task.id)
  notifyGnd([10], 'GND 待验收', `测区「${task.measurementAreaName}」无需优化，请验收`, task.id)
  return task
}

export function completeOptimization(user, taskId, body) {
  requireOptimizer(user)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'optimization_complete', user)
  const from = task.status
  const rec = gndOptimizations.filter(o => o.taskId === task.id && o.round === task.repairRound).at(-1)
  if (rec) { rec.completedAt = nowText(); rec.remark = String(body.remark || rec.remark || '').trim() }
  task.status = 'WAITING_ACCEPTANCE'
  task.optimizationCompletedAt = nowText()
  task.updatedAt = nowText(); task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'WAITING_ACCEPTANCE', '优化完成')
  writeAudit(user, 'gnd.task.optimizationComplete', task.id)
  notifyGnd([10], 'GND 待验收', `测区「${task.measurementAreaName}」优化完成，请验收`, task.id)
  return task
}
