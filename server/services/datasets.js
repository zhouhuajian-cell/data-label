import { tasks, taskItems } from '../repositories/data.js'
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'

function requireDatasetRole(user) {
  if (![1, 6, 7].includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM、算法工程师或数据清洗员可访问数据集')
}

// 数据集 = 含有已验收(accepted)数据的任务（算法仅见验收，清洗员看全部）
function collectAccepted() {
  return taskItems.filter(i => i.status === 'accepted')
}

function collectAll() {
  return taskItems
}

export function listDatasets(user) {
  requireDatasetRole(user)
  const isCleaner = user.roleType === 7
  // 清洗员：看全部任务及标签进度；算法/PM：看已验收数据
  const source = isCleaner ? collectAll() : collectAccepted()
  const byTask = {}
  source.forEach(i => {
    if (!byTask[i.taskId]) byTask[i.taskId] = { count: 0, boxCount: 0, tagged: 0, labels: {}, scenarioTags: {} }
    const g = byTask[i.taskId]
    g.count++
    if ((i.tags || []).length > 0) g.tagged++
    ;(i.tags || []).forEach(t => { g.scenarioTags[t] = (g.scenarioTags[t] || 0) + 1 })
    ;((i.annotation || {}).boxes || []).forEach(b => {
      if (!b.label) return
      g.boxCount++
      g.labels[b.label] = (g.labels[b.label] || 0) + 1
    })
  })
  const datasets = Object.entries(byTask).map(([taskId, g]) => {
    const task = tasks.find(t => t.id === Number(taskId)) || {}
    return {
      taskId: Number(taskId),
      taskName: task.taskName || '未知任务',
      annotateType: task.annotateType || '-',
      supplierName: task.supplierName || '-',
      sampleCount: task.sampleCount || 0,
      acceptedCount: g.count,
      taggedCount: g.tagged,
      boxCount: g.boxCount,
      labelCount: Object.keys(g.labels).length,
      labelDist: Object.entries(g.labels).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      scenarioDist: Object.entries(g.scenarioTags).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    }
  }).sort((a, b) => b.acceptedCount - a.acceptedCount)

  const globalLabels = {}
  const globalScenario = {}
  const allTagged = isCleaner ? taskItems.filter(i => (i.tags || []).length > 0).length : 0
  datasets.forEach(d => {
    d.labelDist.forEach(l => { globalLabels[l.name] = (globalLabels[l.name] || 0) + l.value })
    d.scenarioDist.forEach(s => { globalScenario[s.name] = (globalScenario[s.name] || 0) + s.value })
  })
  const globalLabelDist = Object.entries(globalLabels).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const globalScenarioDist = Object.entries(globalScenario).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  return { datasets, globalLabelDist, globalScenarioDist, allTagged }
}

export function getDatasetItems(user, taskId) {
  requireDatasetRole(user)
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'NOT_FOUND', '任务不存在')
  const isCleaner = user.roleType === 7
  const items = (isCleaner ? taskItems : taskItems.filter(i => i.status === 'accepted'))
    .filter(i => i.taskId === taskId)
    .map(i => ({
      id: i.id, itemName: i.itemName, image: i.image, status: i.status,
      boxes: (i.annotation || {}).boxes || [],
      tags: i.tags || [],
      annotator: i.annotator, workSeconds: i.workSeconds || 0
    }))
  return { task: { id: task.id, taskName: task.taskName, annotateType: task.annotateType }, items }
}

// 导出 COCO 格式 JSON
export function exportDataset(user, taskId) {
  requireDatasetRole(user)
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'NOT_FOUND', '任务不存在')
  const items = taskItems.filter(i => i.taskId === taskId && i.status === 'accepted')

  const categories = []
  const catMap = {}
  let catId = 1
  const annotations = []
  let annId = 1
  const images = items.map(i => {
    ;((i.annotation || {}).boxes || []).forEach(b => {
      if (!b.label) return
      if (!catMap[b.label]) { catMap[b.label] = catId; categories.push({ id: catId, name: b.label, supercategory: 'object' }); catId++ }
      annotations.push({ id: annId++, image_id: i.id, category_id: catMap[b.label], bbox: [b.x, b.y, b.w, b.h], area: b.w * b.h, iscrowd: 0 })
    })
    return { id: i.id, file_name: i.itemName + '.svg', width: 640, height: 360 }
  })

  const coco = {
    info: { description: task.taskName, taskId: task.id, supplier: task.supplierName, exportTime: nowText(), itemCount: items.length, annotationCount: annotations.length },
    licenses: [],
    images,
    annotations,
    categories
  }
  return {
    fileName: `dataset_task${taskId}_${Date.now()}.json`,
    content: JSON.stringify(coco, null, 2)
  }
}
