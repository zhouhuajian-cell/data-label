import { ApiError } from '../lib/http.js'

// 解析 Excel/CSV 为任务明细行（浏览器端送 base64，服务端用 xlsx 解析）
export async function parseTaskExcel(user, body) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方PM可操作')
  const fileData = body.fileData
  if (!fileData) throw new ApiError(422, 'VALIDATION_ERROR', '请上传 Excel 文件')

  const buffer = Buffer.from(fileData, 'base64')
  const fileName = String(body.fileName || 'data.xlsx').toLowerCase()
  let rows = []

  try {
    if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      // CSV 解析（逗号或制表符分隔）
      const text = buffer.toString('utf-8')
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      rows = lines.map(l => l.split(/[,|\t]/).map(s => s.trim().replace(/^"|"$/g, '')))
    } else {
      // Excel 解析
      const XLSX = await import('../../node_modules/xlsx/xlsx.mjs')
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      rows = jsonData
    }
  } catch (e) {
    throw new ApiError(422, 'VALIDATION_ERROR', '文件解析失败：' + e.message)
  }

  if (!rows.length || rows.length < 2) throw new ApiError(422, 'VALIDATION_ERROR', '表格为空或只有表头')

  // 自动识别列
  const header = (rows[0] || []).map((h, i) => ({ text: String(h || '').trim(), index: i }))
  const findCol = (patterns) => {
    const found = header.find(h => patterns.some(p => h.text.includes(p) || new RegExp(p, 'i').test(h.text)))
    return found ? found.index : null
  }
  const colMap = {
    taskName: findCol(['任务名', '名称', 'task', 'name']),
    nanoId: findCol(['编号', 'Nano', 'ID', '序号']),
    annotateType: findCol(['类型', '标注', 'type']),
    sampleCount: findCol(['样本', '数量', '总量', 'count', '图片']),
    deadline: findCol(['截止', '日期', 'deadline', '时间']),
    unitPrice: findCol(['单价', '价格', 'price', '金额']),
    uploadPath: findCol(['上传路径', '上传', '路径', 'upload', 'path'])
  }

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
  return { tasks, total: tasks.length, columns: header.map(h => h.text).filter(Boolean) }
}
