import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../lib/http.js'
import { auditLogs, submissions, suppliers, taskLogs, tasks, taskItems } from '../repositories/data.js'
import { createNotification } from './notifications.js'
import { nowText } from '../lib/time.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads')

const buyerRole = 1; const qaRole = 2; const supplierRole = 3

function ensureUploadsDir() { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }) }
function requireBuyer(user) { if (user.roleType !== buyerRole && user.roleType !== qaRole) throw new ApiError(403, 'FORBIDDEN', '仅甲方/质检可操作') }
function requireSupplier(user) { if (user.roleType !== supplierRole) throw new ApiError(403, 'FORBIDDEN', '仅供应商可操作') }
function canAccessTask(user, task) { return user.roleType !== supplierRole || task.supplierId === user.supplierId }
function findVisibleTask(user, taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task || !canAccessTask(user, task)) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  return task
}
function addLog(taskId, content, type = 'primary') { taskLogs.push({ taskId, time: nowText(), content, type }) }

function checkOverdue(task) {
  if (task.state === 'ACCEPTED' || task.state === 'ARCHIVED' || task.state === 'REJECTED') return
  if (!task.deadline) return
  const dl = new Date(task.deadline.replace(/-/g, '/')).getTime()
  if (Date.now() > dl) {
    task.state = 'REJECTED'
    addLog(task.id, '任务已逾期，超出交付截止时间', 'danger')
  }
}

export function listSuppliers(user) { requireBuyer(user); return suppliers }

export function listTasks(user, query) {
  const page = Math.max(Number(query.get('page') || 1), 1)
  const pageSize = Math.min(Math.max(Number(query.get('pageSize') || 10), 1), 100)
  const searchKey = String(query.get('searchKey') || '').trim().toLowerCase()
  const state = String(query.get('state') || '').trim()
  const projectId = query.get('projectId')

  let filtered = tasks
  filtered = filtered.filter(t => canAccessTask(user, t))
  if (projectId) filtered = filtered.filter(t => Number(t.projectId) === Number(projectId))
  if (state) filtered = filtered.filter(t => t.state === state)
  if (searchKey) filtered = filtered.filter(t => String(t.id).includes(searchKey) || t.taskName.toLowerCase().includes(searchKey) || (t.nanoId || '').toLowerCase().includes(searchKey))

  filtered.forEach(checkOverdue)
  filtered = filtered.sort((a, b) => b.id - a.id)

  const start = (page - 1) * pageSize
  return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize }
}

export function getTaskDetail(user, taskId) {
  const task = findVisibleTask(user, taskId)
  checkOverdue(task)
  return { task, stateLog: taskLogs.filter(l => l.taskId === taskId), versions: submissions.filter(s => s.taskId === taskId) }
}

export function createTask(user, body) {
  requireBuyer(user)
  ensureUploadsDir()
  const taskName = String(body.taskName || '').trim()
  const annotateType = String(body.annotateType || '').trim()
  const sampleCount = Number(body.sampleCount)
  const unitPrice = Number(body.unitPrice)
  const deadline = String(body.deadline || '').trim()
  if (!taskName || !annotateType || !deadline || !isFinite(sampleCount) || sampleCount <= 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '请填写完整任务信息')
  }

  let dataPackage = null
  const dp = body.dataPackage
  if (dp && dp.fileName && dp.data) {
    const safeName = dp.fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_')
    const storedName = `task_${Date.now()}_${safeName}`
    fs.writeFileSync(path.join(uploadsDir, storedName), Buffer.from(dp.data, 'base64'))
    dataPackage = { fileName: dp.fileName, storedName, size: Buffer.from(dp.data, 'base64').length }
  }

  const task = {
    id: Math.max(...tasks.map(t => t.id)) + 1, taskName,
    nanoId: String(body.nanoId || '').trim(),
    annotateType, state: 'UNASSIGNED', deadline, sampleCount, unitPrice,
    totalPrice: Number((sampleCount * unitPrice).toFixed(2)),
    supplierId: null, supplierName: '', currentRework: 0,
    qaStandard: String(body.qaStandard || '<p>请按项目规范完成标注并提交成果包。</p>'),
    ownerId: user.id, projectId: body.projectId || null,
    qaSamplingRate: body.qaSamplingRate !== undefined ? Number(body.qaSamplingRate) : 1.0,
    submitTime: null, acceptTime: null, rejectCount: 0, dataPackage
  }
  tasks.push(task)
  addLog(task.id, user.userName + ' 创建任务，状态：待作业')
  auditLogs.push({ action: 'task.create', actorId: user.id, taskId: task.id, at: nowText() })
  return task
}

export function dispatchTask(user, taskId, body) {
  requireBuyer(user)
  const task = findVisibleTask(user, taskId)
  if (!['UNASSIGNED', 'REJECTED'].includes(task.state)) throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可派发')
  const supplier = suppliers.find(s => s.id === Number(body.supplierId))
  if (!supplier) throw new ApiError(422, 'VALIDATION_ERROR', '请选择有效供应商')
  task.supplierId = supplier.id; task.supplierName = supplier.name
  task.state = body.immediateStart ? 'ANNOTATING' : 'UNASSIGNED'
  if (body.qaSamplingRate !== undefined) task.qaSamplingRate = Number(body.qaSamplingRate)
  addLog(task.id, '派发给' + supplier.name + (body.immediateStart ? '，供应商开始作业' : '，等待接单'))
  auditLogs.push({ action: 'task.dispatch', actorId: user.id, taskId, supplierId: supplier.id, at: nowText() })
  createNotification(null, 'task', '新任务派发', `甲方已将「${task.taskName}」派发至${supplier.name}，请及时接单作业`, 'task', taskId)
  return task
}

export function acceptTask(user, taskId) {
  requireSupplier(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'UNASSIGNED') throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可接单')
  task.state = 'ANNOTATING'
  addLog(task.id, user.userName + ' 接单，开始标注作业')
  auditLogs.push({ action: 'task.accept', actorId: user.id, taskId, at: nowText() })
  return task
}

export function completeWork(user, taskId) {
  requireSupplier(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'ANNOTATING') throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可完成作业')
  task.state = 'VENDOR_QA'
  addLog(task.id, user.userName + ' 完成作业，内部质检通过，待提交交付')
  return task
}

export function submitTask(user, taskId, body) {
  requireSupplier(user)
  const task = findVisibleTask(user, taskId)
  if (!['VENDOR_QA', 'REJECTED'].includes(task.state)) throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可提交')

  const submitDesc = String(body.submitDesc || '').trim()
  if (!body.fileName) throw new ApiError(422, 'VALIDATION_ERROR', '请上传标注成果文件')

  // 保存文件数据
  let storedName = null
  if (body.fileData) {
    ensureUploadsDir()
    const safeName = body.fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_')
    storedName = `sub_${taskId}_${Date.now()}_${safeName}`
    fs.writeFileSync(path.join(uploadsDir, storedName), Buffer.from(body.fileData, 'base64'))
  }

  const version = 'v' + (submissions.filter(s => s.taskId === taskId).length + 1) + '.0'
  // 版本快照：保存当前任务下所有明细的标注用于后续质检对比（PRD 4.2 对齐对比模式）
  const itemsSnapshot = taskItems
    .filter(i => i.taskId === taskId)
    .map(i => ({ itemId: i.id, itemName: i.itemName, boxes: ((i.annotation || {}).boxes || []).map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, label: b.label })) }))
  const submission = {
    id: submissions.length + 1, taskId, version,
    submitTime: nowText(), submitUser: user.userName,
    score: null, pass: null, result: null, qaReport: false,
    fileName: body.fileName, storedName, submitDesc: submitDesc || '已完成标注作业，请验收',
    attachments: body.attachments || [],
    deliveryDoc: body.deliveryDoc || '',
    qaReportText: body.qaReportText || '',
    rejectReason: null, reviewComment: null,
    itemsSnapshot
  }
  submissions.push(submission)
  task.state = 'CLIENT_QA'
  task.submitTime = nowText()
  addLog(task.id, user.userName + ' 提交 ' + version + ' 版成果，等待甲方验收', 'warning')
  auditLogs.push({ action: 'task.submit', actorId: user.id, taskId, at: nowText() })
  createNotification(null, 'task', '供应商提交交付', `${task.supplierName} 已提交「${task.taskName}」${version} 版（${body.fileName}），请甲方质检验收`, 'task', task.id)
  return submission
}

export function reviewTask(user, taskId, body) {
  requireBuyer(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'CLIENT_QA') throw new ApiError(409, 'TASK_STATE_CONFLICT', '仅待验收状态可操作')

  const pass = Boolean(body.pass)
  const score = Number(body.score)
  const comment = String(body.comment || '').trim()
  const rejectReason = String(body.rejectReason || '').trim()

  if (!isFinite(score) || score < 0 || score > 100) throw new ApiError(422, 'VALIDATION_ERROR', '分数需在0-100之间')
  if (!pass && comment.length < 5) throw new ApiError(422, 'VALIDATION_ERROR', '驳回时请填写具体原因')
  if (!pass && !rejectReason) throw new ApiError(422, 'VALIDATION_ERROR', '请选择驳回原因分类')

  const latest = submissions.filter(s => s.taskId === taskId).at(-1)
  if (latest) {
    latest.score = score; latest.pass = pass
    latest.result = pass ? '验收通过' : '驳回整改'
    latest.qaReport = true; latest.reviewComment = comment
    latest.rejectReason = rejectReason || null
  }
  task.state = pass ? 'ACCEPTED' : 'REJECTED'
  if (pass) {
    task.acceptTime = nowText()
  } else {
    task.rejectCount = (task.rejectCount || 0) + 1; task.currentRework = (task.currentRework || 0) + 1
  }
  addLog(task.id, user.userName + (pass ? ' 验收通过，得分' + score : ' 驳回整改：' + rejectReason + '，得分' + score), pass ? 'success' : 'danger')
  auditLogs.push({ action: pass ? 'task.pass' : 'task.reject', actorId: user.id, taskId, score, at: nowText() })
  const notifyTitle = pass ? '验收通过' : '驳回整改'
  const notifyContent = pass
    ? `「${task.taskName}」已通过甲方验收，得分 ${score} 分，进入结算`
    : `「${task.taskName}」被甲方驳回（${rejectReason || comment}），得分 ${score} 分，请整改后重新提交`
  createNotification(null, pass ? 'qa' : 'qa', notifyTitle, notifyContent, 'task', task.id)
  return task
}

export function updateTask(user, taskId, body) {
  requireBuyer(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'UNASSIGNED') throw new ApiError(409, 'TASK_STATE_CONFLICT', '任务派发后不可修改，如需调整请先撤回派发')
  const updatable = ['taskName', 'nanoId', 'annotateType', 'sampleCount', 'unitPrice', 'deadline', 'qaStandard', 'qaSamplingRate']
  for (const key of updatable) { if (body[key] !== undefined) task[key] = body[key] }
  if (body.sampleCount !== undefined || body.unitPrice !== undefined) {
    task.totalPrice = Number(((body.sampleCount ?? task.sampleCount) * (body.unitPrice ?? task.unitPrice)).toFixed(2))
  }
  addLog(task.id, user.userName + ' 更新了任务信息')
  auditLogs.push({ action: 'task.update', actorId: user.id, taskId, at: nowText() })
  return task
}

export function deleteTask(user, taskId) {
  requireBuyer(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'UNASSIGNED') throw new ApiError(409, 'TASK_STATE_CONFLICT', '仅待作业状态可删除')
  const idx = tasks.findIndex(t => t.id === taskId)
  if (idx >= 0) tasks.splice(idx, 1)
  auditLogs.push({ action: 'task.delete', actorId: user.id, taskId, at: nowText() })
  return { deleted: true }
}

export function importProjectTasks(user, projectId, body) {
  requireBuyer(user)
  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', '导入数据不能为空')
  let imported = 0
  const maxId = Math.max(...tasks.map(t => t.id), 0)
  for (const row of rows) {
    const taskName = String(row.taskName || '').trim()
    if (!taskName) continue
    tasks.push({
      id: maxId + imported + 1, taskName,
      nanoId: String(row.nanoId || '').trim(),
      annotateType: String(row.annotateType || '2D拉框').trim(),
      state: 'UNASSIGNED', deadline: String(row.deadline || '-').trim(),
      sampleCount: Number(row.sampleCount) || 0, unitPrice: Number(row.unitPrice) || 0,
      totalPrice: 0, supplierId: null, supplierName: '',
      currentRework: 0, qaStandard: String(row.qaStandard || '<p>请按项目规范完成标注并提交成果包。</p>').trim(),
      ownerId: user.id, projectId,
      submitTime: null, acceptTime: null, rejectCount: 0
    })
    imported++
  }
  auditLogs.push({ action: 'task.batchImport', actorId: user.id, projectId, count: imported, at: nowText() })
  return { imported }
}
