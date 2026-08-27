import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../lib/http.js'
import { auditLogs, submissions, suppliers, taskLogs, tasks, taskItems, ERROR_TYPES } from '../repositories/data.js'
import { createNotification, notifyByRole } from './notifications.js'
import { nowText } from '../lib/time.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsDir = path.resolve(__dirname, '../../uploads')

// 生成验收报告：统计通过/返修(甲方驳回)/驳回原因汇总
function buildAcceptanceReport(taskId) {
  const items = taskItems.filter(i => i.taskId === taskId)
  const total = items.length
  const passed = items.filter(i => i.status === 'accepted').length
  // 甲方驳回过的明细（history 含 client_reject，或 firstPass=false 且返工过）
  const rework = items.filter(i =>
    (i.history || []).some(h => h.action === 'client_reject') ||
    (i.clientReviewed === true && i.firstPass === false)
  ).length
  const rejected = items.filter(i => i.status === 'rework').length

  // 驳回原因汇总（仅统计甲方驳回的 errorTypes）
  const errMap = {}
  items.forEach(i => {
    const types = new Set()
    ;(i.history || []).forEach(h => {
      if (h.action === 'client_reject') (h.errorTypes || []).forEach(t => types.add(t))
    })
    types.forEach(t => { errMap[t] = (errMap[t] || 0) + 1 })
  })
  const errLabel = {}
  ERROR_TYPES.forEach(t => { errLabel[t.value] = t.label })
  const reasonLines = Object.entries(errMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${errLabel[k] || k}：${v} 条`)

  const lines = []
  lines.push(`**任务**：${tasks.find(t => t.id === taskId)?.taskName || taskId}`)
  lines.push(`**验收结果**：通过 ${passed} 条 / 返修 ${rework} 条 / 共 ${total} 条`)
  if (rework > 0) {
    lines.push('')
    lines.push('**返修原因汇总**：')
    if (reasonLines.length) lines.push(...reasonLines)
    else lines.push('- （未记录具体原因）')
  }
  return lines.join('\n')
}

export function pushAcceptanceReport(taskId, actorName) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return
  createNotification(null, 'qa', '验收报告', `${task.taskName}\n${buildAcceptanceReport(taskId)}\n\n> 验收人：${actorName} · ${nowText()}`, 'task', taskId)
}

const buyerRole = 1; const qaRole = 2; const supplierRole = 3
// 供应商侧角色（3=团队长 4=标注员）都受数据隔离约束（与 workbench.js ensureSupplierScope 一致）
const supplierSideRoles = [3, 4]

function ensureUploadsDir() { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }) }
function requireBuyer(user) { if (![1, 2, 7].includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅甲方/质检/清洗可操作') }
function requireSupplier(user) { if (user.roleType !== supplierRole) throw new ApiError(403, 'FORBIDDEN', '仅供应商可操作') }
function canAccessTask(user, task) { return !supplierSideRoles.includes(user.roleType) || task.supplierId === user.supplierId }
function findVisibleTask(user, taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task || !canAccessTask(user, task)) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  return task
}
function addLog(taskId, content, type = 'primary') { taskLogs.push({ taskId, time: nowText(), content, type }) }

// 检查任务下明细是否全部达到某个状态
function checkItemsState(taskId, status) {
  const items = taskItems.filter(i => i.taskId === taskId)
  if (!items.length) return true
  return items.every(i => i.status === status || (status === 'annotated' && ['annotated','vendor_passed','accepted'].includes(i.status)) || (status === 'vendor_passed' && ['vendor_passed','accepted'].includes(i.status)))
}

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
  const logs = taskLogs.filter(l => l.taskId === taskId)
  // 兜底：任务已验收但时间线没有验收记录时自动补一条
  if (task.state === 'ACCEPTED' && !logs.some(l => l.content.includes('验收'))) {
    logs.push({ taskId, time: task.acceptTime || nowText(), content: '甲方验收通过，任务完成', type: 'success' })
  }
  const items = taskItems
    .filter(i => i.taskId === taskId)
    .map(i => ({ id: i.id, itemName: i.itemName, dataType: i.dataType, status: i.status, uploadPath: i.uploadPath || '', annotator: i.annotator || '', failReason: i.failReason || '', rejectImages: i.rejectImages || [], rejectNote: i.rejectNote || '', reworkCount: i.reworkCount || 0, lastResubmitAt: i.lastResubmitAt || '' }))
  return { task, stateLog: logs, versions: submissions.filter(s => s.taskId === taskId), items }
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
    id: Math.max(0, ...tasks.map(t => Number(t.id) || 0)) + 1, taskName,
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

// 给任务上传/更新数据包（供供应商下载原始数据）
export function uploadTaskPackage(user, taskId, body) {
  requireBuyer(user)
  const task = findVisibleTask(user, taskId)
  const fileName = String(body.fileName || '').trim()
  if (!fileName || !body.fileData) throw new ApiError(422, 'VALIDATION_ERROR', '请上传数据包文件')
  ensureUploadsDir()
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_')
  const storedName = `taskpkg_${taskId}_${Date.now()}_${safeName}`
  const buffer = Buffer.from(body.fileData, 'base64')
  fs.writeFileSync(path.join(uploadsDir, storedName), buffer)
  task.dataPackage = { fileName, storedName, size: buffer.length }
  addLog(task.id, user.userName + ' 上传数据包 ' + fileName)
  auditLogs.push({ action: 'task.packageUpload', actorId: user.id, taskId, fileName, at: nowText() })
  return task.dataPackage
}

export function dispatchTask(user, taskId, body) {
  requireBuyer(user)
  const task = findVisibleTask(user, taskId)
  if (!['UNASSIGNED', 'REJECTED'].includes(task.state)) throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可派发')
  // 必须先导入明细才能派发
  if (!taskItems.some(i => i.taskId === taskId)) throw new ApiError(422, 'VALIDATION_ERROR', '请先导入任务明细，再派发给供应商')
  const supplier = suppliers.find(s => s.id === Number(body.supplierId))
  if (!supplier) throw new ApiError(422, 'VALIDATION_ERROR', '请选择有效供应商')
  task.supplierId = supplier.id; task.supplierName = supplier.name
  // 立即开工 = 直接进入供应商标注中；否则等待供应商接单（接单后进入标注中）
  task.state = body.immediateStart ? 'ANNOTATING' : 'UNASSIGNED'
  if (body.qaSamplingRate !== undefined) task.qaSamplingRate = Number(body.qaSamplingRate)
  addLog(task.id, '派发给' + supplier.name + (body.immediateStart ? '，供应商开始标注作业' : '，等待接单'))
  auditLogs.push({ action: 'task.dispatch', actorId: user.id, taskId, supplierId: supplier.id, at: nowText() })
  // 新任务派发 → 通知该供应商的人（团队长+标注员）去接单
  notifyByRole(supplier.id, [3, 4], 'task', '新任务派发', `甲方已将「${task.taskName}」派发至${supplier.name}，请及时接单作业`, 'task', taskId)
  return task
}

export function acceptTask(user, taskId) {
  requireSupplier(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'UNASSIGNED') throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可接单')
  task.state = 'ANNOTATING'
  addLog(task.id, user.userName + ' 接单，开始标注作业')
  auditLogs.push({ action: 'task.accept', actorId: user.id, taskId, at: nowText() })
  // 供应商接单 → 通知甲方（PM/QA）已接单，进入标注中
  notifyByRole(null, [1, 2], 'task', '供应商开始标注', `${task.supplierName} 已接单「${task.taskName}」，进入供应商标注中`, 'task', taskId)
  return task
}

export function completeWork(user, taskId) {
  requireSupplier(user)
  const task = findVisibleTask(user, taskId)
  if (task.state !== 'ANNOTATING') throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可完成作业')
  task.state = 'VENDOR_QA'
  addLog(task.id, user.userName + ' 完成作业，待供应商内部质检')
  auditLogs.push({ action: 'task.completeWork', actorId: user.id, taskId, at: nowText() })
  // 供应商完成作业 → 通知甲方（PM/QA）可开始质检
  notifyByRole(null, [1, 2], 'task', '供应商完成作业', `${task.supplierName} 已完成「${task.taskName}」标注，进入供应商内部质检`, 'task', taskId)
  return task
}

export function submitTask(user, taskId, body) {
  requireSupplier(user)
  const task = findVisibleTask(user, taskId)
  if (!['VENDOR_QA', 'REJECTED'].includes(task.state)) throw new ApiError(409, 'TASK_STATE_CONFLICT', '当前状态不可提交')

  const submitDesc = String(body.submitDesc || '').trim()
  if (!body.fileName || !body.fileData) throw new ApiError(422, 'VALIDATION_ERROR', '请上传标注成果文件（数据包不能为空）')

  // 明细级提交：勾选的明细置为「已提交」；未勾选默认全选
  const taskItems2 = taskItems.filter(i => i.taskId === taskId)
  let submittedItemIds = Array.isArray(body.itemIds) ? body.itemIds.map(Number) : []
  if (!submittedItemIds.length) submittedItemIds = taskItems2.map(i => i.id)
  const validItemIds = new Set(taskItems2.map(i => i.id))
  for (const id of submittedItemIds) {
    if (!validItemIds.has(id)) throw new ApiError(422, 'VALIDATION_ERROR', '提交的明细不属于该任务')
  }
  taskItems2.forEach(item => {
    if (submittedItemIds.includes(item.id)) {
      item.status = 'submitted'
      if (!Array.isArray(item.history)) item.history = []
      item.history.push({ time: nowText(), actor: user.userName, action: 'submit' })
    }
  })

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
    submittedItemIds,
    itemsSnapshot
  }
  submissions.push(submission)
  task.state = 'CLIENT_QA'
  task.submitTime = nowText()
  addLog(task.id, user.userName + ' 提交 ' + version + ' 版成果，等待甲方验收', 'warning')
  auditLogs.push({ action: 'task.submit', actorId: user.id, taskId, at: nowText() })
  // 供应商提交交付 → 通知甲方（PM/QA）验收
  notifyByRole(null, [1, 2], 'task', '待甲方质检提醒', `${task.supplierName} 已提交「${task.taskName}」${version} 版成果，任务状态为待甲方质检，请安排验收`, 'task', task.id)
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
    // 验收通过 → 将任务下所有待验收明细同步为已验收
    const taskItems2 = taskItems.filter(i => i.taskId === taskId)
    taskItems2.forEach(item => {
      if (item.status === 'submitted') {
        item.status = 'accepted'
        item.clientReviewed = true
        item.firstPass = (item.reworkCount || 0) === 0
        if (!Array.isArray(item.history)) item.history = []
        item.history.push({ time: nowText(), actor: user.userName, action: 'client_pass' })
      } else if (['vendor_passed', 'accepted'].includes(item.status)) {
        if (item.status === 'vendor_passed') {
          item.status = 'accepted'
          item.clientReviewed = true
          item.firstPass = (item.reworkCount || 0) === 0
          if (!Array.isArray(item.history)) item.history = []
          item.history.push({ time: nowText(), actor: user.userName, action: 'client_pass' })
        }
      }
    })
    // 验收通过 → 自动生成结算单
    import('./settlement.js').then(m => m.autoGenerateSettlement(taskId, user.userName)).catch(() => {})
    // 验收报告（含通过/返修统计 + 驳回原因汇总）
    pushAcceptanceReport(taskId, user.userName)
  } else {
    task.rejectCount = (task.rejectCount || 0) + 1; task.currentRework = (task.currentRework || 0) + 1
    // 驳回 → 已提交明细标记返工
    taskItems.filter(i => i.taskId === taskId && i.status === 'submitted').forEach(item => {
      item.status = 'rework'
      item.clientReviewed = true
      if (!Array.isArray(item.history)) item.history = []
      item.history.push({ time: nowText(), actor: user.userName, action: 'client_reject' })
    })
  }
  addLog(task.id, user.userName + (pass ? ' 验收通过，得分' + score : ' 驳回整改：' + rejectReason + '，得分' + score), pass ? 'success' : 'danger')
  auditLogs.push({ action: pass ? 'task.pass' : 'task.reject', actorId: user.id, taskId, score, at: nowText() })
  if (!pass) {
    // 驳回整改 → 通知该供应商的人整改
    notifyByRole(task.supplierId, [3, 4], 'qa', '驳回整改', `「${task.taskName}」被甲方驳回（${rejectReason || comment}），得分 ${score} 分，请整改后重新提交`, 'task', task.id)
  }
  return task
}

const STATE_CN = { UNASSIGNED: '待标注', ANNOTATING: '标注中', VENDOR_QA: '供应商质检', CLIENT_QA: '已提交待甲方验收', ACCEPTED: '已验收', REJECTED: '驳回整改', ARCHIVED: '已归档' }
// 供应商可手动修改的任务状态（排除已验收/已归档，防绕过甲方验收）
const SUPPLIER_EDITABLE_STATES = ['UNASSIGNED', 'ANNOTATING', 'VENDOR_QA', 'CLIENT_QA', 'REJECTED']
export function updateTaskState(user, taskId, body) {
  const task = findVisibleTask(user, taskId)
  const state = String(body.state || '').trim()
  if (!SUPPLIER_EDITABLE_STATES.includes(state)) {
    throw new ApiError(422, 'VALIDATION_ERROR', '该状态不允许手动修改')
  }
  const from = task.state
  task.state = state
  task.updatedAt = nowText()
  addLog(task.id, user.userName + ' 手动更新任务状态：' + (STATE_CN[from] || from) + ' → ' + (STATE_CN[state] || state))
  auditLogs.push({ action: 'task.updateState', actorId: user.id, taskId, from, to: state, at: nowText() })
  // 任务状态变为待甲方质检(CLIENT_QA) → 飞书提醒甲方
  if (state === 'CLIENT_QA') {
    notifyByRole(null, [1, 2], 'task', '待甲方质检提醒', `${user.userName} 将任务「${task.taskName}」状态改为待甲方质检，请安排验收`, 'task', taskId)
  }
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
