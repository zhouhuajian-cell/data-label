// GND 域冒烟测试：状态机正向流转、非法跳步、权限隔离、里程差异规则
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSupplier } from '../server/services/gnd-users.js'
import { createTask } from '../server/services/gnd-tasks.js'
import { receiveTask, submitTask } from '../server/services/gnd-submission.js'
import { skipOptimization } from '../server/services/gnd-optimization.js'
import { acceptance } from '../server/services/gnd-acceptance.js'
import { warehouse } from '../server/services/gnd-warehouse.js'
import { repair } from '../server/services/gnd-perception.js'

const admin = { id: 99, roleType: 8, supplierId: null, name: '测试泰兴管理员' }
const optimizer = { id: 102, roleType: 9, supplierId: null, name: '测试优化员' }
const acceptor = { id: 103, roleType: 10, supplierId: null, name: '测试验收员' }
const perception = { id: 104, roleType: 11, supplierId: null, name: '测试感知团队' }

// 供应商名册与账号（测试进程内共享）
const supplierA = createSupplier(admin, { name: '测试供应商A', code: 'TS-A' })
const supplierB = createSupplier(admin, { name: '测试供应商B', code: 'TS-B' })
const userA = { id: 100, roleType: 12, supplierId: supplierA.id, name: '供应商A交付员' }
const userB = { id: 101, roleType: 12, supplierId: supplierB.id, name: '供应商B交付员' }

function makeTask(name, scene = 'scene.urban', city = 'city.hangzhou', supplierId = supplierA.id) {
  return createTask(admin, {
    measurementAreaName: name,
    city,
    vehicleModel: 'model.m5',
    dataType: 'data.gnd',
    sourceDataPath: '/data/raw/' + name,
    taskIndexPath: '/data/index/' + name,
    initialRoadScene: scene,
    supplierId
  })
}

test('GND 正向流转：创建→接收→提交→优化→验收→入库→返修→重新交付', () => {
  const task = makeTask('GND-TEST-001')
  assert.equal(task.status, 'WAITING_ANNOTATION')

  receiveTask(userA, task.id)
  assert.equal(task.status, 'PROCESSING')

  submitTask(userA, task.id, { supplierMileage: 12.35, supplierRoadScene: 'scene.highway' })
  assert.equal(task.status, 'WAITING_OPTIMIZATION')

  skipOptimization(optimizer, task.id, {})
  assert.equal(task.status, 'WAITING_ACCEPTANCE')

  acceptance(acceptor, task.id, { acceptanceMileage: 12.1, acceptanceRoadScene: 'scene.highway', result: 'PASSED' })
  assert.equal(task.status, 'ACCEPTED')

  warehouse(admin, task.id, { result: 'QUALIFIED' })
  assert.equal(task.status, 'WAREHOUSED')

  repair(perception, task.id, { repairReason: '场景标注与实车不符' })
  assert.equal(task.status, 'REPAIR_REQUIRED')

  submitTask(userA, task.id, { supplierMileage: 12.2, supplierRoadScene: 'scene.urban' })
  assert.equal(task.status, 'WAITING_OPTIMIZATION')
  assert.equal(task.repairRound, 1)
})

test('非法跳步：待接收状态直接验收必须失败', () => {
  const task = makeTask('GND-TEST-002')
  assert.throws(() => acceptance(acceptor, task.id, { acceptanceMileage: 10, acceptanceRoadScene: 'scene.urban', result: 'PASSED' }),
    err => err.code === 'TASK_INVALID_STATUS')
})

test('权限隔离：供应商 B 不能操作供应商 A 的任务', () => {
  const task = makeTask('GND-TEST-003')
  assert.throws(() => receiveTask(userB, task.id), err => err.code === 'SUPPLIER_DATA_FORBIDDEN')
})

test('权限隔离：验收员不能入库，供应商不能验收', () => {
  const task = makeTask('GND-TEST-004', 'scene.tunnel')
  receiveTask(userA, task.id)
  submitTask(userA, task.id, { supplierMileage: 5, supplierRoadScene: 'scene.tunnel' })
  skipOptimization(optimizer, task.id, {})
  // 供应商不能验收
  assert.throws(() => acceptance(userA, task.id, { acceptanceMileage: 5, acceptanceRoadScene: 'scene.tunnel', result: 'PASSED' }),
    err => err.code === 'FORBIDDEN')
  // 验收员验收后，供应商不能入库
  acceptance(acceptor, task.id, { acceptanceMileage: 5, acceptanceRoadScene: 'scene.tunnel', result: 'PASSED' })
  assert.throws(() => warehouse(userA, task.id, { result: 'QUALIFIED' }), err => err.code === 'FORBIDDEN')
})

test('里程差异超 5% 未填差异说明必须失败', () => {
  const task = makeTask('GND-TEST-005', 'scene.parking')
  receiveTask(userA, task.id)
  submitTask(userA, task.id, { supplierMileage: 100, supplierRoadScene: 'scene.parking' })
  skipOptimization(optimizer, task.id, {})
  // 验收 110 vs 供应商 100，差异 10% > 5%
  assert.throws(() => acceptance(acceptor, task.id, { acceptanceMileage: 110, acceptanceRoadScene: 'scene.parking', result: 'PASSED' }),
    err => err.code === 'MILEAGE_DIFFERENCE_REQUIRES_EXPLANATION')
  acceptance(acceptor, task.id, { acceptanceMileage: 110, acceptanceRoadScene: 'scene.parking', result: 'PASSED', differenceExplanation: '对齐脚本复核后里程修正' })
  assert.equal(task.status, 'ACCEPTED')
})
