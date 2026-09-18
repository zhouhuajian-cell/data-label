import { ApiError } from '../lib/http.js'
import { auditLogs, projects, projectStats, tasks, taskItems, taskLogs, submissions, governedItems, governedDatasets, bills } from '../repositories/data.js'
import { nowText } from '../lib/time.js'
import { hasAnyRole, hasRole, roleTypesOf } from '../lib/roles.js'
import { isSupplierOnly, sameSupplier } from '../lib/bill-flow.js'
import { deleteBillRow } from '../repositories/finance-db.js'

const buyerRole = 1
const qaRole = 2
const cleanerRole = 7

const VALID_STATUSES = ['active', 'completed', 'paused', 'archived']
const STATUS_LABELS = { active: '进行中', completed: '已完成', paused: '已暂停', archived: '已归档' }

function requireBuyer(user) {
  if (!hasAnyRole(user, [buyerRole, qaRole, cleanerRole])) {
    throw new ApiError(403, 'FORBIDDEN', '只有甲方、质检或数据清洗角色可以执行该操作')
  }
}

// 建项目/改项目：供应商(3)同样允许 —— 供应商在项目管理页建项目并上传验收数据
const PROJECT_EDITABLE_ROLES = [buyerRole, qaRole, cleanerRole, 3]

function requireProjectEditor(user) {
  if (!hasAnyRole(user, PROJECT_EDITABLE_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', '无权创建或修改项目')
  }
}

// 查看项目。供应商(3)也开放：结算是以项目为导向的，项目页是供应商上传验收数据的入口
function canViewProjects(user) {
  return hasAnyRole(user, [buyerRole, qaRole, cleanerRole, 3])
}

export function getProjectStats(user) {
  return { projectCount: projects.length }
}

export function updateProjectCount(user, body) {
  requireBuyer(user)
  const action = String(body.action || '').trim().toLowerCase()
  const delta = action === 'increment' ? 1 : action === 'decrement' ? -1 : 0
  if (delta === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'action 必须为 increment 或 decrement')
  }
  projectStats.projectCount = Math.max(0, projectStats.projectCount + delta)
  auditLogs.push({ action: 'project.updateCount', actorId: user.id, delta, at: nowText() })
  return { projectCount: projectStats.projectCount }
}

// 供应商数据隔离：供应商只能看到「自己建的」或「项目里有自己名下结算单」的项目；
// 内部角色（管理员/确认链角色）不受限
function projectVisibleTo(user, p) {
  if (!isSupplierOnly(user)) return true
  // 有创建人字段：只认自己建的
  if (p.createdBy !== undefined && p.createdBy !== null) return Number(p.createdBy) === Number(user.id)
  // 历史项目缺创建人：项目里有自己名下的结算单才可见（避免看到别家项目）
  return bills.some(b => b.projectId === p.id && sameSupplier(b, user))
}

function assertProjectVisible(user, p) {
  if (!projectVisibleTo(user, p)) {
    throw new ApiError(403, 'PROJECT_FORBIDDEN', '无权访问其他供应商的项目')
  }
}

export function listProjects(user) {
  if (!canViewProjects(user)) throw new ApiError(403, 'FORBIDDEN', '无权查看项目')
  return projects.slice().filter(p => projectVisibleTo(user, p)).sort((a, b) => b.id - a.id)
}

export function getProjectDetail(user, projectId) {
  if (!canViewProjects(user)) throw new ApiError(403, 'FORBIDDEN', '无权查看项目')
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  assertProjectVisible(user, project)
  return { project }
}

// 结算确认单按项目结算：项目下拉对发起方与四级确认人开放（只读精简字段）
const PROJECT_OPTION_ROLES = [1, 2, 3, 7, 13, 14, 15, 16]

export function listProjectOptions(user) {
  if (!hasAnyRole(user, PROJECT_OPTION_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', '无权查看项目列表')
  }
  return projects.slice()
    .filter(p => projectVisibleTo(user, p))
    .sort((a, b) => b.id - a.id)
    .map(p => ({ id: p.id, name: p.name, clientName: p.clientName, bizType: p.bizType, status: p.status }))
}

export function createProject(user, body) {
  requireProjectEditor(user)
  const name = String(body.name || '').trim()
  const clientName = String(body.clientName || '').trim()
  const annotateType = String(body.annotateType || '').trim()
  const bizType = String(body.bizType || '').trim()
  const sampleCount = Number(body.sampleCount)
  const deadline = String(body.deadline || '').trim()
  const description = String(body.description || '').trim()
  const template = String(body.template || '').trim()
  const uploadPath = String(body.uploadPath || '').trim()
  const datasetId = body.datasetId ? Number(body.datasetId) : null

  if (!name) throw new ApiError(422, 'VALIDATION_ERROR', '请输入项目名称')
  // 数据类型（annotateType）：选填，也可自定义填写
  // 业务类型（bizType）：选填，默认「标注」，也允许自定义
  if (bizType.length > 32) throw new ApiError(422, 'VALIDATION_ERROR', '业务类型最多 32 个字')

  const project = {
    id: Math.max(...projects.map(p => p.id), 0) + 1,
    name, clientName, annotateType, bizType: bizType || '标注',
    sampleCount: Number.isFinite(sampleCount) && sampleCount > 0 ? sampleCount : 0,
    deadline: deadline || '-',
    status: 'active', description,
    template, uploadPath,
    datasetId,
    // 供应商项目隔离依赖创建人：必须记录
    createdBy: user.id, createdByName: user.userName,
    createdAt: nowText(), updatedAt: nowText()
  }
  projects.push(project)
  projectStats.projectCount = projects.length
  auditLogs.push({ action: 'project.create', actorId: user.id, projectId: project.id, at: nowText() })
  return project
}

export function updateProjectStatus(user, projectId, body) {
  requireBuyer(user)
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  assertProjectVisible(user, project)

  const status = String(body.status || '').trim()
  if (!VALID_STATUSES.includes(status)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `状态必须为: ${VALID_STATUSES.join('/')}`)
  }

  project.status = status
  project.updatedAt = nowText()
  auditLogs.push({ action: 'project.updateStatus', actorId: user.id, projectId, status, at: nowText() })
  return project
}

export function updateProject(user, projectId, body) {
  requireProjectEditor(user)
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  assertProjectVisible(user, project)
  const updatable = ['name', 'clientName', 'annotateType', 'bizType', 'deadline', 'description', 'template', 'uploadPath']
  for (const key of updatable) {
    if (body[key] !== undefined) project[key] = String(body[key]).trim()
  }
  if (!project.name) throw new ApiError(422, 'VALIDATION_ERROR', '项目名称不能为空')
  project.updatedAt = nowText()
  auditLogs.push({ action: 'project.update', actorId: user.id, projectId, at: nowText() })
  return project
}

export function importProjects(user, body) {
  requireBuyer(user)
  const rows = body.rows || body
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', '导入数据不能为空')
  }

  let imported = 0
  const maxId = Math.max(...projects.map(p => p.id), 0)

  for (const row of rows) {
    const name = String(row.name || row['项目名称'] || '').trim()
    if (!name) continue

    const project = {
      id: maxId + imported + 1,
      name,
      clientName: String(row.clientName || row['客户名称'] || '').trim(),
      annotateType: String(row.annotateType || row['标注类型'] || '').trim(),
      sampleCount: Number(row.sampleCount || row['样本数量']) || 0,
      deadline: String(row.deadline || row['截止时间'] || '-').trim(),
      status: 'active',
      description: String(row.description || row['描述'] || '').trim(),
      createdAt: nowText(),
      updatedAt: nowText()
    }
    projects.push(project)
    imported++
  }

  projectStats.projectCount = projects.length
  auditLogs.push({ action: 'project.import', actorId: user.id, count: imported, at: nowText() })
  return { imported }
}

export async function deleteProject(user, projectId) {
  // 供应商也可删除项目（与建项目同权限）
  requireProjectEditor(user)
  const idx = projects.findIndex(p => p.id === projectId)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  assertProjectVisible(user, projects[idx])

  // 护栏：项目下已有结算单则不允许删除，否则结算单会失去项目归属，成本中心/项目报表断链。
  // 管理员（role 1）可以强制删除，连同该项目下的结算单一起级联清除（用于清理误建数据）
  const attachedBills = bills.filter(b => b.projectId === projectId)
  let deletedBills = 0
  if (attachedBills.length) {
    if (!hasRole(user, buyerRole)) {
      throw new ApiError(409, 'PROJECT_HAS_BILLS',
        `该项目已提交过 ${attachedBills.length} 张结算单，不能删除；请先处理掉这些结算单再删项目`)
    }
    for (const b of attachedBills) {
      await deleteBillRow(b.id)
      const bi = bills.findIndex(x => x.id === b.id)
      if (bi >= 0) bills.splice(bi, 1)
      deletedBills++
    }
    auditLogs.push({ action: 'project.deleteBills', actorId: user.id, projectId, count: deletedBills, at: nowText() })
  }

  // 级联删除项目下的所有任务及其明细、日志、交付记录
  const taskIdSet = new Set(tasks.filter(t => t.projectId === projectId).map(t => t.id))
  const deletedTasks = taskIdSet.size
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].projectId === projectId) tasks.splice(i, 1)
  }
  for (let i = taskItems.length - 1; i >= 0; i--) {
    if (taskIdSet.has(taskItems[i].taskId)) taskItems.splice(i, 1)
  }
  for (let i = taskLogs.length - 1; i >= 0; i--) {
    if (taskIdSet.has(taskLogs[i].taskId)) taskLogs.splice(i, 1)
  }
  for (let i = submissions.length - 1; i >= 0; i--) {
    if (taskIdSet.has(submissions[i].taskId)) submissions.splice(i, 1)
  }

  projects.splice(idx, 1)
  auditLogs.push({ action: 'project.delete', actorId: user.id, projectId, deletedTasks, at: nowText() })
  return { deleted: true, deletedTasks }
}

// 自动拆分：将项目绑定的治理数据集拆分为 N 个任务（每 batch 条数据 = 1 个 Task）
export function splitProjectDataset(user, projectId, body) {
  requireBuyer(user)
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  assertProjectVisible(user, project)
  if (!project.datasetId) throw new ApiError(422, 'VALIDATION_ERROR', '该项目未绑定治理数据集，请先绑定')

  const itemsPerTask = Math.max(Number(body.itemsPerTask) || 10, 1)
  const dsItems = governedItems.filter(i => i.datasetId === project.datasetId)
  if (!dsItems.length) throw new ApiError(422, 'VALIDATION_ERROR', '绑定的数据集无数据')

  const existingCount = tasks.filter(t => t.projectId === projectId).length
  const baseTaskId = Math.max(...tasks.map(t => t.id), 0)
  const baseItemId = Math.max(...taskItems.map(t => t.id), 0)
  const createdTasks = []
  let taskIdx = 0

  for (let i = 0; i < dsItems.length; i += itemsPerTask) {
    taskIdx++
    const batch = dsItems.slice(i, i + itemsPerTask)
    const taskName = `${project.name}_Batch${String(existingCount + taskIdx).padStart(2, '0')}`

    const task = {
      id: baseTaskId + taskIdx,
      taskName,
      nanoId: `T${String(taskIdx).padStart(3, '0')}`,
      uploadPath: project.uploadPath || '',
      annotateType: project.annotateType || '2D拉框',
      state: 'UNASSIGNED',
      deadline: project.deadline || '-',
      sampleCount: batch.length,
      unitPrice: 0.1,
      totalPrice: Number((batch.length * 0.1).toFixed(2)),
      supplierId: null, supplierName: '', currentRework: 0,
      qaStandard: '<p>请按项目规范完成标注并提交成果包。</p>',
      ownerId: user.id, projectId,
      submitTime: null, acceptTime: null, rejectCount: 0
    }
    tasks.push(task)
    createdTasks.push(task)

    const itemsStartId = baseItemId + (taskIdx - 1) * itemsPerTask + 1
    batch.forEach((gItem, idx) => {
      taskItems.push({
        id: itemsStartId + idx,
        taskId: task.id,
        itemName: gItem.itemName,
        dataType: '图像',
        status: 'pending',
        failReason: '', screenshot: null, annotator: '',
        image: gItem.image,
        annotation: { boxes: [] },
        claimedBy: null, workSeconds: 0, isRework: false,
        errorTypes: [], rejectNote: '', submitCount: 0, reworkCount: 0,
        clientReviewed: false, firstPass: null, history: [],
        tags: gItem.tags || []
      })
    })
  }

  // 更新项目样本量
  project.sampleCount = dsItems.length
  project.updatedAt = nowText()
  auditLogs.push({ action: 'project.split', actorId: user.id, projectId, taskCount: createdTasks.length, itemCount: dsItems.length, at: nowText() })
  return { createdTasks: createdTasks.length, totalItems: dsItems.length, itemsPerTask, tasks: createdTasks }
}

// 项目结项归档：将所有已验收的任务数据生成 Dataset 版本快照
export function archiveProject(user, projectId) {
  requireBuyer(user)
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  assertProjectVisible(user, project)
  if (project.status !== 'active') throw new ApiError(409, 'STATE_CONFLICT', '仅进行中的项目可结项')

  const projTasks = tasks.filter(t => t.projectId === projectId)
  const acceptedTasks = projTasks.filter(t => t.state === 'ACCEPTED')
  if (!acceptedTasks.length) throw new ApiError(422, 'VALIDATION_ERROR', '项目下无已验收的任务，无法结项')
  if (projTasks.some(t => !['ACCEPTED', 'ARCHIVED'].includes(t.state))) {
    throw new ApiError(422, 'VALIDATION_ERROR', '项目下仍有未完成的任务，请等待全部验收后再结项')
  }

  const acceptedItems = taskItems.filter(i => acceptedTasks.some(t => t.id === i.taskId) && i.status === 'accepted')
  if (!acceptedItems.length) throw new ApiError(422, 'VALIDATION_ERROR', '无验收数据可归档')

  const versionNo = governedDatasets.filter(d => d.projectId === projectId).length + 1
  const ds = {
    id: governedDatasets.length + 1,
    name: `${project.name}_V${versionNo}.0`,
    fileName: `${project.name}_V${versionNo}.0.json`,
    fileSize: 0,
    md5: '',
    itemCount: acceptedItems.length,
    status: 'ARCHIVED',
    projectId, type: 'ARCHIVE',
    uploadTime: nowText(),
    creatorId: user.id, creatorName: user.userName
  }
  governedDatasets.push(ds)

  // 快照：复制验收数据到治理库作为归档版本
  const baseId = governedItems.length + 1
  acceptedItems.forEach((item, idx) => {
    governedItems.push({
      id: baseId + idx,
      datasetId: ds.id,
      itemName: item.itemName,
      image: item.image,
      metadata: { width: 640, height: 360, format: 'svg' },
      tags: item.tags || [],
      annotationSnapshot: item.annotation ? { boxes: [...(item.annotation.boxes || [])] } : null
    })
  })

  // 标记所有任务为已归档
  acceptedTasks.forEach(t => { t.state = 'ARCHIVED' })
  project.status = 'archived'
  project.updatedAt = nowText()

  auditLogs.push({ action: 'project.archive', actorId: user.id, projectId, datasetId: ds.id, itemCount: acceptedItems.length, taskCount: acceptedTasks.length, at: nowText() })
  // 推送飞书
  import('./feishu.js').then(m => m.pushProjectSummary(user, projectId)).catch(() => {})
  return { archivedDataset: { id: ds.id, name: ds.name, itemCount: ds.itemCount, taskCount: acceptedTasks.length } }
}

// 从 Excel/CSV 文件解析任务并批量创建（延迟加载 xlsx 与 tasks 服务，保持启动轻量）
export async function importProjectTasksFromFile(user, projectId, body) {
  const { parseTaskExcel } = await import('./excel.js')
  const { createTask } = await import('./tasks.js')
  const result = await parseTaskExcel(user, body)
  if (!result.tasks || !result.tasks.length) throw new ApiError(422, 'VALIDATION_ERROR', '未解析到任务')
  let imported = 0
  for (const t of result.tasks) {
    await createTask(user, { ...t, projectId })
    imported++
  }
  return { imported }
}
