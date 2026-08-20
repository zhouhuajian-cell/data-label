// GND 测区任务服务：创建 / 列表 / 详情 / 修改基础字段 / 作废
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import {
  gndTasks, gndSubmissions, gndOptimizations, gndAcceptances,
  gndWarehouseRecords, gndPerceptions, gndStatusHistory, gndFieldHistory,
  gndSuppliers
} from '../repositories/data.js'
import { isOptionValid } from '../lib/gnd-options.js'
import { assertTransition } from '../lib/gnd-state-machine.js'
import { nextId, gndEnsureTaskVisible, writeStatusHistory, writeFieldHistory, writeAudit, currentSubmission, supplierName, notifyGnd } from './gnd-common.js'

const TAIXING_ADMIN = 8
const SUPPLIER = 12
const PERCEPTION = 11

function requireRole(user, role) {
  if (user.roleType !== role) throw new ApiError(403, 'FORBIDDEN', '当前角色无权限执行该操作')
}

function validateEnumField(body, key, category) {
  if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
    if (!isOptionValid(category, body[key])) {
      throw new ApiError(422, key === 'initialRoadScene' ? 'ROAD_SCENE_INVALID' : 'VALIDATION_ERROR', `${key} 不在枚举配置中`)
    }
  }
}

function validatePath(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${fieldName} 必填`)
  }
}
// ===== 创建测区任务（泰兴管理员 8）=====
export function createTask(user, body) {
  requireRole(user, TAIXING_ADMIN)
  const name = String(body.measurementAreaName || '').trim()
  if (!name) throw new ApiError(422, 'VALIDATION_ERROR', 'measurementAreaName 必填')
  const dup = gndTasks.some(t => t.measurementAreaName === name && t.status !== 'VOIDED')
  if (dup) throw new ApiError(409, 'MEASUREMENT_AREA_DUPLICATE', '测区名称已存在')

  const required = ['city', 'vehicleModel', 'dataType', 'initialRoadScene']
  for (const k of required) {
    if (!body[k]) throw new ApiError(422, 'VALIDATION_ERROR', `${k} 必填`)
  }
  validateEnumField(body, 'city', 'CITY')
  validateEnumField(body, 'vehicleModel', 'VEHICLE_MODEL')
  validateEnumField(body, 'dataType', 'DATA_TYPE')
  validateEnumField(body, 'initialRoadScene', 'ROAD_SCENE')
  validatePath(body.sourceDataPath, 'sourceDataPath')
  validatePath(body.taskIndexPath, 'taskIndexPath')
  if (!body.supplierId || !gndSuppliers.some(s => s.id === Number(body.supplierId))) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'supplierId 必填且存在于供应商名册')
  }

  const task = {
    id: nextId(gndTasks),
    measurementAreaName: name,
    city: body.city,
    vehicleModel: body.vehicleModel,
    version: String(body.version || '').trim(),
    dataType: body.dataType,
    sourceDataPath: body.sourceDataPath,
    taskIndexPath: body.taskIndexPath,
    initialRoadScene: body.initialRoadScene,
    supplierId: Number(body.supplierId),
    status: 'WAITING_ANNOTATION',
    repairRound: 0,
    receivedAt: null,
    submittedAt: null,
    optimizationCompletedAt: null,
    acceptedAt: null,
    warehousedAt: null,
    createdBy: user.id,
    createdAt: nowText(),
    updatedBy: user.id,
    updatedAt: nowText()
  }
  gndTasks.push(task)
  writeStatusHistory(task, user, null, 'WAITING_ANNOTATION', '创建测区任务')
  writeAudit(user, 'gnd.task.create', task.id, { measurementAreaName: name })
  notifyGnd([SUPPLIER], 'GND 新任务', `测区「${name}」已分配，请接收`, task.id)
  return task
}

// ===== 任务列表 =====
export function listTasks(user, q) {
  let list = gndTasks.slice()
  if (user.roleType === SUPPLIER) list = list.filter(t => t.supplierId === user.supplierId)
  if (user.roleType === PERCEPTION) list = list.filter(t => t.status === 'WAREHOUSED')
  const f = (k) => String(q.get(k) || '').trim()
  if (f('keyword')) { const kw = f('keyword').toLowerCase(); list = list.filter(t => t.measurementAreaName.toLowerCase().includes(kw)) }
  if (f('status')) { list = list.filter(t => t.status === f('status')) }
  if (f('city')) list = list.filter(t => t.city === f('city'))
  if (f('supplier_id')) list = list.filter(t => t.supplierId === Number(f('supplier_id')))
  if (f('data_type')) list = list.filter(t => t.dataType === f('data_type'))
  if (f('road_scene')) {
    const rs = f('road_scene')
    list = list.filter(t => {
      const acc = latestByRound(gndAcceptances, t.id)
      const sub = currentSubmission(t)
      return (acc && acc.acceptanceRoadScene === rs) || (sub && sub.supplierRoadScene === rs) || t.initialRoadScene === rs
    })
  }
  if (f('created_from')) list = list.filter(t => t.createdAt >= f('created_from'))
  if (f('created_to')) list = list.filter(t => t.createdAt <= f('created_to'))

  list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  const page = Math.max(Number(q.get('page') || 1), 1)
  const pageSize = Math.min(Math.max(Number(q.get('page_size') || 20), 1), 100)
  const total = list.length
  const items = list.slice((page - 1) * pageSize, page * pageSize).map(t => {
    const sub = currentSubmission(t)
    const acc = latestByRound(gndAcceptances, t.id)
    return {
      id: t.id, measurementAreaName: t.measurementAreaName, city: t.city, vehicleModel: t.vehicleModel,
      supplierId: t.supplierId, supplierName: supplierName(t.supplierId),
      status: t.status, repairRound: t.repairRound,
      supplierMileage: sub ? sub.supplierMileage : null,
      acceptanceMileage: acc ? acc.acceptanceMileage : null,
      acceptanceRoadScene: acc ? acc.acceptanceRoadScene : null,
      updatedAt: t.updatedAt
    }
  })
  return { items, total, page, pageSize }
}

function latestByRound(arr, taskId) {
  const list = arr.filter(x => x.taskId === taskId)
  return list.length ? list.sort((a, b) => a.round - b.round)[list.length - 1] : null
}

// ===== 任务详情（聚合）=====
export function getTaskDetail(user, taskId) {
  const task = gndEnsureTaskVisible(user, taskId)
  const byRound = arr => arr.filter(x => x.taskId === taskId).sort((a, b) => a.round - b.round)
  return {
    ...task,
    supplierName: supplierName(task.supplierId),
    submissions: byRound(gndSubmissions),
    optimizations: byRound(gndOptimizations),
    acceptances: byRound(gndAcceptances),
    warehouses: byRound(gndWarehouseRecords),
    perception: gndPerceptions.find(p => p.taskId === taskId) || null,
    statusHistory: gndStatusHistory.filter(h => h.taskId === taskId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
    fieldHistory: gndFieldHistory.filter(h => h.taskId === taskId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  }
}

// ===== 修改基础字段（泰兴管理员 8，仅未接收前）=====
export function updateTask(user, taskId, body) {
  requireRole(user, TAIXING_ADMIN)
  const task = gndEnsureTaskVisible(user, taskId)
  if (task.status !== 'WAITING_ANNOTATION' || task.receivedAt !== null) {
    throw new ApiError(409, 'TASK_STATE_CONFLICT', '仅供应商接收前可修改基础字段')
  }
  const updatable = ['city', 'vehicleModel', 'version', 'dataType', 'sourceDataPath', 'taskIndexPath', 'initialRoadScene', 'supplierId']
  const changed = []
  for (const k of updatable) {
    if (body[k] === undefined) continue
    const old = task[k]
    let val = body[k]
    if (k === 'version') val = String(val || '').trim()
    if (k === 'supplierId') {
      val = Number(val)
      if (!gndSuppliers.some(s => s.id === val)) throw new ApiError(422, 'VALIDATION_ERROR', 'supplierId 不存在于供应商名册')
    } else {
      const cat = k === 'initialRoadScene' ? 'ROAD_SCENE' : k === 'city' ? 'CITY' : k === 'vehicleModel' ? 'VEHICLE_MODEL' : 'DATA_TYPE'
      validateEnumField({ [k]: val }, k, cat)
      if (k === 'sourceDataPath' || k === 'taskIndexPath') validatePath(val, k)
    }
    task[k] = val
    writeFieldHistory(task, user, k, old, val)
    changed.push(k)
  }
  task.updatedBy = user.id
  task.updatedAt = nowText()
  writeAudit(user, 'gnd.task.update', task.id, { fields: changed })
  return task
}

// ===== 作废任务（泰兴管理员 8，仅未接收前）=====
export function voidTask(user, taskId, body) {
  requireRole(user, TAIXING_ADMIN)
  const task = gndEnsureTaskVisible(user, taskId)
  assertTransition(task, 'void_task', user)
  const reason = String(body.reason || '').trim()
  if (!reason) throw new ApiError(422, 'VALIDATION_ERROR', '作废原因必填')
  const from = task.status
  task.status = 'VOIDED'
  task.updatedAt = nowText()
  task.updatedBy = user.id
  writeStatusHistory(task, user, from, 'VOIDED', reason)
  writeAudit(user, 'gnd.task.void', task.id, { reason })
  return task
}
