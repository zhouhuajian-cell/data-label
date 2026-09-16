// 验收结算确认单 API（含验收数据导入解析）
import { request } from './client.js'

// 上传 Excel/CSV（base64）解析预览：返回识别到的明细行与列名
export const parseAcceptanceFileApi = (fileData, fileName) =>
  request('/finance/bills/parse', { method: 'POST', body: { fileData, fileName } })

// 列表：query 支持 page/pageSize/status/scope(todo|done)/supplierName/keyword/dateFrom/dateTo
// 附件留存：上传原始文件（产出明细表等），返回可写入单据的引用
export const uploadAttachmentApi = (fileData, fileName) =>
  request('/finance/attachments', { method: 'POST', body: { fileData, fileName } })

export const listBillsApi = (params = {}) => {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v)
  })
  const query = qs.toString()
  return request('/finance/bills' + (query ? '?' + query : ''))
}

export const getBillDetailApi = (id) => request(`/finance/bills/${id}`)
export const createBillApi = (body) => request('/finance/bills', { method: 'POST', body })
export const updateBillApi = (id, body) => request(`/finance/bills/${id}`, { method: 'PUT', body })
export const deleteBillApi = (id) => request(`/finance/bills/${id}`, { method: 'DELETE' })

// comment：确认意见；submittedTotal：统结方节点必填的统一结算总金额
export const confirmBillApi = (id, comment, submittedTotal, extra) =>
  request(`/finance/bills/${id}/confirm`, {
    method: 'POST',
    body: { comment, ...(submittedTotal ? { submittedTotal } : {}), ...(extra || {}) }
  })

// 财务核算：扣款/税率 → 应付金额（仅「待财务确认」阶段）
export const calculateBillApi = (id, payload) => request(`/finance/bills/${id}/calculate`, { method: 'POST', body: payload })
export const rejectBillApi = (id, reason) => request(`/finance/bills/${id}/reject`, { method: 'POST', body: { reason } })
export const resubmitBillApi = (id) => request(`/finance/bills/${id}/resubmit`, { method: 'POST', body: {} })

export const getBillStatsApi = () => request('/finance/stats')

// 可指派的工程师名单（财务指派用）
export const listEngineersApi = () => request('/finance/engineers')
// 结算汇总看板（供应商管理页）：累积结算 + 成本中心金额分布 + 周期累积
export const settlementSummaryApi = (params = {}) => {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v)
  })
  const query = qs.toString()
  return request('/finance/settlement-summary' + (query ? '?' + query : ''))
}

// 供应商姓名清单（甲方PM 代建单时选供应商；口径=姓名，不再用归属供应商 id）
export const listSupplierNamesApi = () => request('/finance/supplier-names')
// 指派工程师（财务）：供应商提交后指定本项目的数据确认人
export const assignEngineerApi = (id, engineerId) =>
  request(`/finance/bills/${id}/assign`, { method: 'POST', body: { engineerId } })

// 统结方提交统结数据（导入解析后提交）/ 重新提交（停在二次确认时可改正）
export const resubmitSettlementApi = (id, payload) =>
  request(`/finance/bills/${id}/resubmit-settlement`, { method: 'POST', body: payload || {} })

// 加急催办：催当前环节的处理人（10 分钟内同一单只能催一次）
export const urgeBillApi = (id, note) =>
  request(`/finance/bills/${id}/urge`, { method: 'POST', body: { note: note || '' } })

// 明细级对账导出（CSV 文件下载）
export const billExportPath = (params = {}) => {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v)
  })
  const query = qs.toString()
  return '/finance/export' + (query ? '?' + query : '')
}
