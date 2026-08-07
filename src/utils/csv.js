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
