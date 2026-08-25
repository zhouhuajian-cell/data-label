import { ApiError } from '../lib/http.js'
import { auditLogs, projects, projectStats, tasks, taskItems, taskLogs, submissions, governedItems, governedDatasets } from '../repositories/data.js'
import { nowText } from '../lib/time.js'

const buyerRole = 1
const qaRole = 2
const cleanerRole = 7

const VALID_STATUSES = ['active', 'completed', 'paused', 'archived']
const STATUS_LABELS = { active: '进行中', completed: '已完成', paused: '已暂停', archived: '已归档' }

function requireBuyer(user) {
  if (![buyerRole, qaRole, cleanerRole].includes(user.roleType)) {
    throw new ApiError(403, 'FORBIDDEN', '只有甲方、质检或数据清洗角色可以执行该操作')
  }
}

// 查看项目（含供应商：仅能查看与自己任务相关的项目）
function canViewProjects(user) {
  return [buyerRole, qaRole, cleanerRole].includes(user.roleType)
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

export function listProjects(user) {
  if (!canViewProjects(user)) throw new ApiError(403, 'FORBIDDEN', '无权查看项目')
  if (user.roleType === 3) {
    // 供应商仅看到自己承接任务的关联项目
    const projIds = new Set(tasks.filter(t => t.supplierId === user.supplierId).map(t => t.projectId))
    return projects.filter(p => projIds.has(p.id)).sort((a, b) => b.id - a.id)
  }
  return projects.slice().sort((a, b) => b.id - a.id)
}

export function getProjectDetail(user, projectId) {
  if (!canViewProjects(user)) throw new ApiError(403, 'FORBIDDEN', '无权查看项目')
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  return { project }
}

export function createProject(user, body) {
  requireBuyer(user)
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
  if (!annotateType) throw new ApiError(422, 'VALIDATION_ERROR', '请选择标注类型')
  // 业务类型：数据闭环 / vslam（未选择时默认数据闭环）
  const BIZ_TYPES = ['数据闭环', 'vslam']
  if (bizType && !BIZ_TYPES.includes(bizType)) throw new ApiError(422, 'VALIDATION_ERROR', '业务类型必须为数据闭环或vslam')

  const project = {
    id: Math.max(...projects.map(p => p.id), 0) + 1,
    name, clientName, annotateType, bizType: bizType || '数据闭环',
    sampleCount: Number.isFinite(sampleCount) && sampleCount > 0 ? sampleCount : 0,
    deadline: deadline || '-',
    status: 'active', description,
    template, uploadPath,
    datasetId,
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
  requireBuyer(user)
  const project = projects.find(p => p.id === projectId)
  if (!project) throw new ApiError(404, 'NOT_FOUND', '项目不存在')
  const updatable = ['name', 'clientName', 'annotateType', 'deadline', 'description', 'template', 'uploadPath']
  for (const key of updatable) {
    if (body[key] !== undefined) project[key] = String(body[key]).trim()
  }
  if (!project.name) throw new ApiError(422, 'VALIDATION_ERROR', '项目名称不能为空')
  if (!project.annotateType) throw new ApiError(422, 'VALIDATION_ERROR', '请选择标注类型')
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
      annotateType: String(row.annotateType || row['标注类型'] || '2D拉框').trim(),
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

export function deleteProject(user, projectId) {
  requireBuyer(user)
  const idx = projects.findIndex(p => p.id === projectId)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '项目不存在')

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
