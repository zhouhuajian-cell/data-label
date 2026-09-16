// CSV 解析工具（引号感知，支持字段内含逗号/引号）
export function parseCsvLine(line) {
  const cells = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += ch
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',' || ch === '\t') {
      cells.push(cur.trim()); cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

export function parseCsvRows(text) {
  return text.trim().split('\n').filter(l => l.trim()).map(parseCsvLine)
}

// 任务导入行：任务名称,标注类型,样本数量,截止时间,标注规范
export function parseTaskLines(text) {
  return parseCsvRows(text).map(p => ({
    taskName: p[0] || '-',
    annotateType: p[1] || '2D拉框',
    sampleCount: Number(p[2]) || 0,
    deadline: p[3] || '-',
    qaStandard: p[4] || ''
  }))
}

// 明细导入行：明细名称,数据类型,标注人,标注状态,备注,数据上传路径
export function parseItemsLines(text) {
  return parseCsvRows(text).map(p => ({
    itemName: p[0] || '',
    dataType: p[1] || '',
    annotator: p[2] || '',
    status: p[3] || 'pending',
    failReason: p[4] || '',
    uploadPath: p[5] || ''
  })).filter(r => r.itemName)
}

// ===== 验收数据粘贴解析（结算确认单明细）=====
// 模板列（与下载的 CSV 模板一致）：序号, 项目, 单位, 数量, 单价（RMB）, 总金额（RMB）
// 兼容旧 8 列格式：任务名称, 数据类型, 验收日期, 数量, 单价, 金额, 数据路径, 备注
export const ACCEPTANCE_COLUMNS = ['序号', '项目', '单位', '数量', '单价（RMB）', '总金额（RMB）']

export const ACCEPTANCE_SAMPLE = [
  ACCEPTANCE_COLUMNS.join('\t'),
  ['1', '烁雨7月标注数据-批次A', '帧', '1000', '0.85', '850'].join('\t')
].join('\n')

// 表头别名 → 内部字段（按表头名映射，跟列顺序无关）
const ACCEPTANCE_ALIASES = [
  ['taskName', ['项目', '任务名称', '任务名', '任务', '名称', '批次', '测区', '路段']],
  ['unit', ['单位', '规格']],
  ['quantity', ['数量', '元素量', '数据量', '工作量', '里程']],
  ['unitPrice', ['单价（RMB）', '单价(RMB)', '单价', '价格']],
  ['amount', ['总金额（RMB）', '总金额(RMB)', '总金额', '金额', '合计', '小计']],
  ['dataType', ['数据类型', '类型']],
  ['acceptDate', ['验收日期', '验收时间', '日期']],
  ['dataPath', ['数据路径', '路径']],
  ['remark', ['备注', '说明']]
]

// 无表头时的固定列序：新 6 列优先，其次旧 8 列
const ACCEPTANCE_POSITIONS = [
  { taskName: 0, unit: 1, quantity: 2, unitPrice: 3, amount: 4 },
  { taskName: 0, dataType: 1, acceptDate: 2, quantity: 3, unitPrice: 4, amount: 5, dataPath: 6, remark: 7 }
]

function acceptanceHeaderMap (headerCells) {
  const map = {}
  headerCells.forEach((raw, idx) => {
    const text = String(raw || '').replace(/\s/g, '')
    if (!text) return
    for (const [field, aliases] of ACCEPTANCE_ALIASES) {
      if (map[field] !== undefined) continue
      if (aliases.some(a => text === a || text.includes(a))) { map[field] = idx; return }
    }
  })
  return map
}

const acceptanceNum = (v) => Number(String(v ?? '').replace(/[,¥￥\s]/g, '')) || 0

// 行金额口径与后端一致：优先 数量×单价，单价缺失时回退表格给出的金额
export function acceptanceRowAmount({ quantity, unitPrice, amount }) {
  const q = Number(quantity) || 0
  const p = Number(unitPrice) || 0
  const a = Number(amount) || 0
  const value = p > 0 ? q * p : (a > 0 ? a : 0)
  // 金额支持小数点后 10 位（与后端 lib/money.js 同口径）
  return Number(value.toFixed(10))
}

export function parseAcceptanceLines(text) {
  const rows = parseCsvRows(text)
  if (!rows.length) return []
  // 首行含表头关键字则跳过（用户从 Excel 复制时通常带表头）
  const head = rows[0].join('')
  const hasHeader = /序号|项目|任务|名称|单位|数量|元素量|单价|金额/.test(head) && isNaN(Number(rows[0][3]))
  const body = hasHeader ? rows.slice(1) : rows

  // 有表头就按表头名映射（新旧模板都能粘贴），没有表头按列数猜固定列序
  const headerMap = hasHeader ? acceptanceHeaderMap(rows[0]) : null
  const pos = !hasHeader && body.length && body[0].length <= 5 ? ACCEPTANCE_POSITIONS[0] : ACCEPTANCE_POSITIONS[1]
  const pick = (p, field) => {
    const idx = headerMap && headerMap[field] !== undefined ? headerMap[field] : pos[field]
    return idx === undefined ? '' : p[idx]
  }

  // 口径同后端：只产出确实存在的列，不额外补 数据类型/数据路径 等空字段
  const hasField = (field) => (headerMap ? headerMap[field] !== undefined : pos[field] !== undefined)
  return body.map(p => {
    const quantity = acceptanceNum(pick(p, 'quantity'))
    const unitPrice = acceptanceNum(pick(p, 'unitPrice'))
    const amount = acceptanceNum(pick(p, 'amount'))
    const row = {
      taskName: String(pick(p, 'taskName') || '').trim(),
      quantity,
      unitPrice,
      amount: acceptanceRowAmount({ quantity, unitPrice, amount })
    }
    for (const field of ['unit', 'dataType', 'acceptDate', 'dataPath', 'remark']) {
      if (hasField(field)) row[field] = String(pick(p, field) || '').trim()
    }
    return row
  }).filter(r => r.taskName)
}
