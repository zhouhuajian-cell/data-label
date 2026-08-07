import crypto from 'node:crypto'
import { ApiError } from '../lib/http.js'
import { makeImage } from '../lib/images.js'
import { governedDatasets, governedItems, auditLogs } from '../repositories/data.js'
import { nowText } from '../lib/time.js'

const GOVERNANCE_ROLES = [6, 1, 7] // R&D(6), PM(1), 清洗(7)

// 把各种格式的日期归一化为 YYYY-MM-DD HH:mm:ss
function normalizeTime(val) {
  const s = String(val).trim()
  if (!s) return ''
  // Excel 日期序列号（如 46210.43）
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 60000) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000))
    return d.toISOString().replace('T', ' ').slice(0, 19)
  }
  // 标准格式
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(s)) {
    let t = s.replace(/\//g, '-')
    if (!/:\d{2}/.test(t)) t += ' 00:00:00'
    else if (t.split(':').length === 2) t += ':00'
    // 补零：YYYY-M-D → YYYY-MM-DD
    t = t.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, mo, d) => y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'))
    t = t.replace(/\s+(\d{1,2}):/, (_, h) => ' ' + String(h).padStart(2, '0') + ':')
    return t
  }
  // ISO / 其他
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().replace('T', ' ').slice(0, 19)
  return s
}

function requireRole(user) {
  if (!GOVERNANCE_ROLES.includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅R&D、清洗员或PM可访问数据治理中心')
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

// 从 Excel/CSV 导入数据集——每行生成一条明细
export async function importDatasetFromFile(user, body) {
  requireRole(user)
  const name = String(body.name || '').trim()
  const fileData = body.fileData
  const fileName = String(body.fileName || 'data.csv').toLowerCase()
  if (!name) throw new ApiError(422, 'VALIDATION_ERROR', '请输入数据集名称')
  if (!fileData) throw new ApiError(422, 'VALIDATION_ERROR', '请上传文件')

  const buffer = Buffer.from(fileData, 'base64')
  let rows = []
  // zip/tar/gz/7z 等压缩包 → 走老逻辑（生成占位数）
  if (/\.(zip|tar|gz|7z)$/i.test(fileName)) {
    const count = body.itemCount || 10
    return importDataset(user, { name, fileName, itemCount: count, fileSize: body.fileSize || 0 })
  }
  try {
    if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      const text = buffer.toString('utf-8')
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      rows = lines.map(l => l.split(/[,|\t]/).map(s => s.trim().replace(/^"|"$/g, '')))
    } else {
      const XLSX = await import('../../node_modules/xlsx/xlsx.mjs')
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    }
  } catch (e) {
    throw new ApiError(422, 'VALIDATION_ERROR', '文件解析失败：' + e.message)
  }

  if (!rows.length) throw new ApiError(422, 'VALIDATION_ERROR', '表格为空')
  const header = rows[0].map(h => String(h || '').trim())
  // 清洗模板列：源数据路径(logs)、批次、车型、单包检测、场景、清洗人、清洗时间、感知意见
  const colPath = header.findIndex(h => /源数据|路径|log/i.test(h))
  const colBatch = header.findIndex(h => /批次/i.test(h))
  const colModel = header.findIndex(h => /车型/i.test(h))
  const colCheck = header.findIndex(h => /单包|检测/i.test(h))
  const colScene = header.findIndex(h => /场景/i.test(h))
  const colName = header.findIndex(h => /名称|name/i.test(h))
  const colCleaner = header.findIndex(h => /清洗人/i.test(h))
  const colTime = header.findIndex(h => /清洗时间/i.test(h))
  const colOpinion = header.findIndex(h => /感知|意见/i.test(h))
  const fileCount = rows.length - 1

  const ds = {
    id: governedDatasets.length + 1,
    name, fileName: body.fileName || fileName,
    fileSize: body.fileSize || 0,
    md5: '', itemCount: fileCount,
    status: 'RAW',
    uploadTime: nowText(),
    creatorId: user.id,
    creatorName: user.userName
  }
  governedDatasets.push(ds)

  const itemBaseId = governedItems.length + 1
  let idx = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    idx++
    const itemName = colPath >= 0 && r[colPath] ? String(r[colPath]).trim() : (colName >= 0 && r[colName] ? String(r[colName]).trim() : `${name}_${String(idx).padStart(4, '0')}`)
    const tags = []
    if (colScene >= 0 && r[colScene]) tags.push(String(r[colScene]).trim())
    const meta = { width: 640, height: 360, format: 'jpg', cleanTime: nowText() }
    if (colBatch >= 0 && r[colBatch]) meta.batch = String(r[colBatch]).trim()
    if (colModel >= 0 && r[colModel]) meta.model = String(r[colModel]).trim()
    if (colCheck >= 0 && r[colCheck]) meta.check = String(r[colCheck]).trim()
    if (colCleaner >= 0 && r[colCleaner]) meta.cleaner = String(r[colCleaner]).trim()
    if (colTime >= 0 && r[colTime]) {
      const rawTime = String(r[colTime]).trim()
      meta.cleanTime = rawTime ? normalizeTime(rawTime) : nowText()
    }
    if (colOpinion >= 0 && r[colOpinion]) meta.opinion = String(r[colOpinion]).trim()
    governedItems.push({
      id: itemBaseId + idx - 1,
      datasetId: ds.id,
      itemName,
      image: makeImage(9000 + idx * 13, itemName),
      metadata: meta,
      tags,
      _row: r.slice(0, 10)
    })
  }

  ds.itemCount = idx
  auditLogs.push({ action: 'governance.import', actorId: user.id, datasetId: ds.id, count: idx, at: nowText() })
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

// 给治理数据打标签（场景Tag）＋可修改清洗时间及各字段
export function tagGovernedItem(user, itemId, body) {
  requireRole(user)
  const item = governedItems.find(i => i.id === itemId)
  if (!item) throw new ApiError(404, 'NOT_FOUND', '数据不存在')
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim()).filter(Boolean) : []
  item.tags = tags
  if (body.cleanTime !== undefined || body.batch !== undefined || body.model !== undefined || body.check !== undefined || body.cleaner !== undefined || body.opinion !== undefined || body.scene !== undefined) {
    if (!item.metadata) item.metadata = {}
    const map = { cleanTime: 'cleanTime', batch: 'batch', model: 'model', check: 'check', cleaner: 'cleaner', opinion: 'opinion', scene: 'sceneStr' }
    Object.entries(map).forEach(([k, field]) => {
      if (body[k] !== undefined) item.metadata[field] = String(body[k] || '')
    })
  }
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

// 删除治理数据集及其所有明细
export function deleteDataset(user, datasetId) {
  requireRole(user)
  const idx = governedDatasets.findIndex(d => d.id === datasetId)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '数据集不存在')
  governedDatasets.splice(idx, 1)
  for (let i = governedItems.length - 1; i >= 0; i--) {
    if (governedItems[i].datasetId === datasetId) governedItems.splice(i, 1)
  }
  auditLogs.push({ action: 'governance.delete', actorId: user.id, datasetId, at: nowText() })
  return { deleted: true }
}

// 删除单条治理数据明细
export function deleteGovernedItem(user, itemId) {
  requireRole(user)
  const idx = governedItems.findIndex(i => i.id === itemId)
  if (idx < 0) throw new ApiError(404, 'NOT_FOUND', '数据不存在')
  governedItems.splice(idx, 1)
  // 更新数据集的 itemCount
  return { deleted: true }
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
