import crypto from 'node:crypto'
import { ApiError } from '../lib/http.js'
import { governedDatasets, governedItems, auditLogs } from '../repositories/data.js'
import { nowText } from '../lib/time.js'

const GOVERNANCE_ROLES = [6, 1, 7] // R&D(6), PM(1), 清洗(7)

function requireRole(user) {
  if (!GOVERNANCE_ROLES.includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅R&D、清洗员或PM可访问数据治理中心')
}

// 生成模拟样本图（SVG Data URL）
function makeImage(seed, label) {
  let s = seed
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
  const palette = ['#6baed6', '#74c476', '#fdae6b', '#fb6a4a', '#9e9ac8', '#78c679', '#fd8d3c']
  // 模拟道路场景
  let shapes = '<rect width="640" height="200" fill="#87ceeb"/><rect y="200" width="640" height="160" fill="#666"/>'
  shapes += '<line x1="0" y1="280" x2="640" y2="280" stroke="#ffcc00" stroke-width="3" stroke-dasharray="20 16"/>'
  for (let i = 0; i < 6; i++) {
    const x = 20 + Math.floor(rnd() * 520)
    const y = 50 + Math.floor(rnd() * 250)
    const w = 40 + Math.floor(rnd() * 120)
    const h = 30 + Math.floor(rnd() * 80)
    shapes += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${palette[i % palette.length]}" opacity="0.85"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">${shapes}<text x="12" y="348" fill="#fff" font-size="12" font-family="monospace" opacity="0.6">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

// 数据导入
export function importDataset(user, body) {
  requireRole(user)
  const name = String(body.name || '').trim()
  const fileCount = Math.min(Math.max(Number(body.itemCount) || 10, 1), 500)
  const fileName = String(body.fileName || 'data.zip').trim()
  if (!name) throw new ApiError(422, 'VALIDATION_ERROR', '请输入数据集名称')

  const ds = {
    id: governedDatasets.length + 1,
    name, fileName,
    fileSize: body.fileSize || 0,
    md5: body.md5 || crypto.createHash('md5').update(name + Date.now()).digest('hex'),
    itemCount: fileCount,
    status: 'RAW',
    uploadTime: nowText(),
    creatorId: user.id,
    creatorName: user.userName
  }
  governedDatasets.push(ds)

  const itemBaseId = governedItems.length + 1
  for (let i = 1; i <= fileCount; i++) {
    const itemName = `${name.replace(/\s/g, '_')}_${String(i).padStart(4, '0')}.jpg`
    governedItems.push({
      id: itemBaseId + i - 1,
      datasetId: ds.id,
      itemName,
      image: makeImage(9000 + i * 13, itemName),
      metadata: { width: 640, height: 360, format: 'jpg' },
      tags: []
    })
  }

  auditLogs.push({ action: 'governance.import', actorId: user.id, datasetId: ds.id, count: fileCount, at: nowText() })
  return ds
}

// 数据集列表
export function listGovernedDatasets(user) {
  requireRole(user)
  return governedDatasets.map(ds => {
    const items = governedItems.filter(i => i.datasetId === ds.id)
    const tagged = items.filter(i => (i.tags || []).length > 0).length
    // 标签分布
    const labelMap = {}
    items.forEach(i => (i.tags || []).forEach(t => { labelMap[t] = (labelMap[t] || 0) + 1 }))
    const labelDist = Object.entries(labelMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    return { ...ds, taggedCount: tagged, labelDist }
  }).sort((a, b) => b.id - a.id)
}

// 数据集详情
export function getDatasetDetail(user, datasetId) {
  requireRole(user)
  const ds = governedDatasets.find(d => d.id === datasetId)
  if (!ds) throw new ApiError(404, 'NOT_FOUND', '数据集不存在')
  const items = governedItems.filter(i => i.datasetId === datasetId)
  const tagged = items.filter(i => (i.tags || []).length > 0).length
  return { dataset: { ...ds, taggedCount: tagged }, items }
}

// 状态变更
export function updateDatasetStatus(user, datasetId, body) {
  requireRole(user)
  const ds = governedDatasets.find(d => d.id === datasetId)
  if (!ds) throw new ApiError(404, 'NOT_FOUND', '数据集不存在')
  const status = String(body.status || '').trim()
  if (!['RAW', 'TAGGED'].includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', '状态仅可为 RAW 或 TAGGED')
  ds.status = status
  auditLogs.push({ action: 'governance.statusChange', actorId: user.id, datasetId, status, at: nowText() })
  return ds
}

// 给治理数据打标签（场景Tag）
export function tagGovernedItem(user, itemId, body) {
  requireRole(user)
  const item = governedItems.find(i => i.id === itemId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '数据不存在')
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : []
  item.tags = tags
  return item
}

export function batchTagGovernedItems(user, body) {
  requireRole(user)
  const ids = Array.isArray(body.itemIds) ? body.itemIds.map(Number) : []
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : []
  if (!ids.length) throw new ApiError(422, 'VALIDATION_ERROR', '请选择数据')
  let done = 0
  ids.forEach(id => {
    const item = governedItems.find(i => i.id === id)
    if (!item) return
    item.tags = [...tags]
    done++
  })
  return { done }
}

// 种子数据：预置一个演示数据集
export function seedGovernanceDemo() {
  if (governedDatasets.length > 0) return
  importDataset(
    { roleType: 6, id: 7, userName: '算法工程师' },
    { name: 'DS_001_street_scenes', fileName: 'street_data_v1.zip', itemCount: 30, fileSize: 15728640, md5: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }
  )
  console.log('数据治理中心：已注入演示数据集 DS_001 (30条)')
}

// 预览拆分：按数据集和每批数量预览生成的任务列表
export function previewSplit(user, body) {
  requireRole(user)
  const datasetId = Number(body.datasetId)
  const itemsPerTask = Math.max(Number(body.itemsPerTask) || 10, 1)
  const dsItems = governedItems.filter(i => i.datasetId === datasetId)
  if (!dsItems.length) throw new ApiError(422, 'VALIDATION_ERROR', '数据集无数据')
  const tasks = []
  for (let i = 0; i < dsItems.length; i += itemsPerTask) {
    const batch = dsItems.slice(i, i + itemsPerTask)
    tasks.push({
      taskName: `Batch${String(tasks.length + 1).padStart(2, '0')}`,
      nanoId: `T${String(tasks.length + 1).padStart(3, '0')}`,
      sampleCount: batch.length,
      items: batch.slice(0, 3).map(g => g.itemName)
    })
  }
  return { tasks, totalItems: dsItems.length, itemsPerTask }
}
