import { ApiError } from '../lib/http.js'
import { computeRowAmount } from '../lib/bill-flow.js'

// 浏览器端送 base64，服务端统一解析为二维数组（Excel / CSV / TXT 共用）
export async function readSheetRows(fileData, fileName) {
  if (!fileData) throw new ApiError(422, 'VALIDATION_ERROR', '请上传文件')
  const buffer = Buffer.from(fileData, 'base64')
  const name = String(fileName || 'data.xlsx').toLowerCase()
  try {
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      // CSV 解析（逗号或制表符分隔）
      const text = buffer.toString('utf-8')
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      return lines.map(l => l.split(/[,|\t]/).map(s => s.trim().replace(/^"|"$/g, '')))
    }
    // Excel 解析
    const XLSX = await import('../../node_modules/xlsx/xlsx.mjs')
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  } catch (e) {
    throw new ApiError(422, 'VALIDATION_ERROR', '文件解析失败：' + e.message)
  }
}

// 表头识别：真实表格常在表头前有标题/说明行，因此在前若干行里挑"匹配列最多"的那一行当表头，
// 并把识别结果一并返回（表头行号、表头文本、命中的字段），便于前端提示"哪列没认出来"。
export const HEADER_SCAN_ROWS = 12

export function buildColumnMap(rows, patterns) {
  const matchers = Object.entries(patterns)
  const scoreRow = (row) => {
    if (!row) return 0
    const texts = row.map(h => String(h || '').trim())
    let hit = 0
    for (const [, list] of matchers) {
      const found = texts.some(t => t && list.some(p => t.includes(p) || new RegExp(p, 'i').test(t)))
      if (found) hit++
    }
    return hit
  }

  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  let headerIndex = 0
  let bestHit = -1
  for (let i = 0; i < limit; i++) {
    const hit = scoreRow(rows[i])
    if (hit > bestHit) { bestHit = hit; headerIndex = i }
  }

  const header = (rows[headerIndex] || []).map((h, i) => ({ text: String(h || '').trim(), index: i }))
  const findCol = (list) => {
    const found = header.find(h => h.text && list.some(p => h.text.includes(p) || new RegExp(p, 'i').test(h.text)))
    return found ? found.index : null
  }
  const colMap = {}
  for (const [field, list] of matchers) colMap[field] = findCol(list)
  const headerText = header.map(h => h.text).filter(Boolean)
  return {
    colMap,
    columns: headerText,
    headerIndex,
    headerText,
    matchedCount: Object.values(colMap).filter(v => v !== null).length
  }
}

function assertRowsReady(rows) {
  if (!rows.length || rows.length < 2) throw new ApiError(422, 'VALIDATION_ERROR', '表格为空或只有表头')
}

// 解析 Excel/CSV 为任务明细行
export async function parseTaskExcel(user, body) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅管理员可操作')
  const rows = await readSheetRows(body.fileData, body.fileName)
  assertRowsReady(rows)

  const { colMap, columns } = buildColumnMap(rows, {
    taskName: ['任务名', '名称', 'task', 'name'],
    nanoId: ['编号', 'Nano', 'ID', '序号'],
    annotateType: ['类型', '标注', 'type'],
    sampleCount: ['样本', '数量', '总量', 'count', '图片'],
    deadline: ['截止', '日期', 'deadline', '时间'],
    unitPrice: ['单价', '价格', 'price', '金额'],
    uploadPath: ['上传路径', '上传', '路径', 'upload', 'path']
  })

  const tasks = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const taskName = colMap.taskName !== null ? String(r[colMap.taskName] || '').trim() : String(r[0] || '').trim()
    if (!taskName) continue
    tasks.push({
      taskName,
      nanoId: colMap.nanoId !== null ? String(r[colMap.nanoId] || '').trim() : '',
      annotateType: colMap.annotateType !== null ? String(r[colMap.annotateType] || '').trim() : '2D拉框',
      sampleCount: colMap.sampleCount !== null ? (Number(r[colMap.sampleCount]) || 0) : 100,
      unitPrice: colMap.unitPrice !== null ? (Number(r[colMap.unitPrice]) || 0.1) : 0.1,
      deadline: colMap.deadline !== null ? String(r[colMap.deadline] || '').trim() : '',
      uploadPath: colMap.uploadPath !== null ? String(r[colMap.uploadPath] || '').trim() : '',
      qaStandard: ''
    })
  }

  if (!tasks.length) throw new ApiError(422, 'VALIDATION_ERROR', '未识别到有效数据行，请检查表头')
  return { tasks, total: tasks.length, columns }
}

// 解析 Excel/CSV 为验收结算明细行（供应商上传已验收数据）
// 模板列：序号 / 项目 / 单位 / 数量 / 单价（RMB）/ 总金额（RMB）；兼容旧的 任务名称/数据类型/验收日期/... 格式
export const ACCEPTANCE_MAX_ROWS = 5000

export async function parseAcceptanceExcel(user, body) {
  if (![1, 3].includes(user.roleType)) throw new ApiError(403, 'FORBIDDEN', '仅供应商或管理员可导入验收数据')
  const rows = await readSheetRows(body.fileData, body.fileName)
  assertRowsReady(rows)
  if (rows.length - 1 > ACCEPTANCE_MAX_ROWS) {
    throw new ApiError(422, 'VALIDATION_ERROR', `单次导入最多 ${ACCEPTANCE_MAX_ROWS} 行，请拆分后分批提交`)
  }

  const meta = buildColumnMap(rows, {
    taskName: ['批次', '任务名', '任务', '测区', '单据', '单号', '名称', '项目', '路段', 'task', 'name', 'no'],
    dataType: ['数据类型', '类型', '标注类型', 'type'],
    unit: ['单位', '规格', 'unit'],
    acceptDate: ['验收日期', '验收时间', '结算日期', '日期', 'date'],
    quantity: ['数量', '元素量', '里程', '条数', '帧数', '数据量', '工作量', '标注量', '样本', 'quantity', 'count', 'qty', 'mileage', 'frame'],
    unitPrice: ['单价（RMB）', '单价(RMB)', '单价', '价格', '费用', '结算价', 'price', 'unit', 'rate'],
    amount: ['总金额（RMB）', '总金额(RMB)', '总金额', '金额', '合计', '小计', '待结算', '结算金额', 'amount', 'total', 'sum'],
    dataPath: ['数据路径', '上传路径', '路径', 'path'],
    remark: ['备注', '说明', 'remark', 'note']
  })
  const { colMap, columns } = meta

  // 表头自检：名称列必须有，数量/金额至少一个 —— 否则就是没认对表头，直接报错而不是生成一堆 0
  if (colMap.taskName === null) {
    throw new ApiError(422, 'HEADER_NOT_RECOGNIZED',
      `未能识别出「任务/单据名称」列。解析器在第 ${meta.headerIndex + 1} 行找到的表头是：${meta.headerText.join(' | ') || '(空)'}`)
  }
  if (colMap.quantity === null && colMap.amount === null) {
    throw new ApiError(422, 'HEADER_NOT_RECOGNIZED',
      `未能识别出「数量」或「金额」列。解析器在第 ${meta.headerIndex + 1} 行找到的表头是：${meta.headerText.join(' | ') || '(空)'}`)
  }

  const pick = (r, key) => (colMap[key] !== null && colMap[key] !== undefined ? String(r[colMap[key]] ?? '').trim() : '')
  const num = (r, key) => {
    const raw = pick(r, key).replace(/[,¥￥\s]/g, '')
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }

  // 口径：表里有什么列就产出什么字段，不额外补 数据类型/验收日期/数据路径/备注 这类空字段
  const hasCol = (key) => colMap[key] !== null && colMap[key] !== undefined
  const items = []
  for (let i = meta.headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const taskName = hasCol('taskName') ? String(r[colMap.taskName] || '').trim() : String(r[0] || '').trim()
    if (!taskName) continue
    const quantity = num(r, 'quantity')
    const unitPrice = num(r, 'unitPrice')
    const declaredAmount = hasCol('amount') ? num(r, 'amount') : 0
    const item = {
      seq: items.length + 1,
      taskName,
      quantity,
      unitPrice,
      amount: computeRowAmount({ quantity, unitPrice, amount: declaredAmount })
    }
    for (const key of ['unit', 'dataType', 'acceptDate', 'dataPath', 'remark']) {
      if (hasCol(key)) item[key] = pick(r, key)
    }
    items.push(item)
  }

  if (!items.length) throw new ApiError(422, 'VALIDATION_ERROR', '未识别到有效数据行，请检查表头')
  // 建议结算公式：有单价列走 数量*单价，否则用表里的金额列
  const hasUnitPrice = colMap.unitPrice !== null && colMap.unitPrice !== undefined
  return {
    items, total: items.length, columns,
    suggestedFormula: hasUnitPrice ? '数量*单价' : '金额',
    hasUnitPrice, hasAmount: colMap.amount !== null,
    headerIndex: meta.headerIndex,
    headerText: meta.headerText,
    matchedFields: Object.entries(colMap).filter(([, v]) => v !== null).map(([k]) => k)
  }
}

// 解析「待结算单」：财务/供应商提供的待结算清单，列比验收数据更杂。
// 目标：识别出可结算的行 + 给出建议公式（有单价→数量*单价；只有金额→金额）
export async function parseSettlementSheet(user, body) {
  if (![1, 3, 14].includes(user.roleType)) {
    throw new ApiError(403, 'FORBIDDEN', '仅供应商、财务或管理员可导入待结算单')
  }
  const rows = await readSheetRows(body.fileData, body.fileName)
  assertRowsReady(rows)

  const meta = buildColumnMap(rows, {
    taskName: ['任务名', '任务', '测区', '单据', '单号', '名称', '项目', 'task', 'name', 'no'],
    dataType: ['数据类型', '类型', '标注类型', 'type'],
    unit: ['单位', '规格', 'unit'],
    acceptDate: ['验收日期', '验收时间', '结算日期', '日期', 'date'],
    quantity: ['数量', '元素量', '里程', '条数', '帧数', '数据量', '工作量', '标注量', '样本', 'quantity', 'count', 'qty', 'mileage', 'frame'],
    unitPrice: ['单价（RMB）', '单价(RMB)', '单价', '价格', '费用', '结算价', 'price', 'unit', 'rate'],
    coefficient: ['系数', '绩效', '质量系数', 'ratio', 'coef'],
    amount: ['总金额（RMB）', '总金额(RMB)', '总金额', '金额', '合计', '小计', '待结算', '结算金额', 'amount', 'total', 'sum'],
    dataPath: ['数据路径', '上传路径', '路径', 'path'],
    remark: ['备注', '说明', 'remark', 'note']
  })
  const { colMap, columns } = meta

  if (colMap.taskName === null) {
    throw new ApiError(422, 'HEADER_NOT_RECOGNIZED',
      `未能识别出「任务/单据名称」列。解析器在第 ${meta.headerIndex + 1} 行找到的表头是：${meta.headerText.join(' | ') || '(空)'}`)
  }
  if (colMap.quantity === null && colMap.amount === null) {
    throw new ApiError(422, 'HEADER_NOT_RECOGNIZED',
      `未能识别出「数量」或「金额」列。解析器在第 ${meta.headerIndex + 1} 行找到的表头是：${meta.headerText.join(' | ') || '(空)'}`)
  }

  const pick = (r, key) => (colMap[key] !== null && colMap[key] !== undefined ? String(r[colMap[key]] ?? '').trim() : '')
  const num = (r, key) => {
    const raw = pick(r, key).replace(/[,¥￥\s]/g, '')
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }

  const items = []
  for (let i = meta.headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const taskName = colMap.taskName !== null ? String(r[colMap.taskName] || '').trim() : String(r[0] || '').trim()
    if (!taskName) continue
    const quantity = num(r, 'quantity')
    const unitPrice = num(r, 'unitPrice')
    const declaredAmount = colMap.amount !== null && colMap.amount !== undefined ? num(r, 'amount') : 0
    const coefficient = colMap.coefficient !== null && colMap.coefficient !== undefined ? (num(r, 'coefficient') || 1) : null
    items.push({
      seq: items.length + 1,
      taskName,
      dataType: pick(r, 'dataType'),
      unit: pick(r, 'unit'),
      acceptDate: pick(r, 'acceptDate'),
      quantity,
      unitPrice,
      amount: computeRowAmount({ quantity, unitPrice, amount: declaredAmount }),
      系数: coefficient,
      dataPath: pick(r, 'dataPath'),
      remark: pick(r, 'remark')
    })
  }
  if (!items.length) throw new ApiError(422, 'VALIDATION_ERROR', '未识别到待结算行，请检查表头（需含任务/单据名称列）')

  // 建议公式：优先 数量*单价（可选带系数），否则用表里的金额列
  const hasUnitPrice = colMap.unitPrice !== null && colMap.unitPrice !== undefined
  const hasCoefficient = items.some(i => i.系数 !== null)
  let suggestedFormula = '金额'
  if (hasUnitPrice) suggestedFormula = hasCoefficient ? '数量*单价*系数' : '数量*单价'

  return {
    items,
    total: items.length,
    columns,
    suggestedFormula,
    coefficient: hasCoefficient ? 1 : null,
    hasUnitPrice,
    hasAmount: colMap.amount !== null && colMap.amount !== undefined
  }
}
