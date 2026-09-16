// 验收结算确认路由（需鉴权）：/api/finance/*
// 覆盖：供应商上传验收数据（含导入解析）→ 业务工程师 → 财务端 → 负责人 → 感知工程师 四级确认
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { ApiError, created, ok, readJson } from '../lib/http.js'
import { BILL_STAGES, BILL_STATUS, assertSupplierVisible } from '../lib/bill-flow.js'
import { streamDownload } from '../lib/download.js'
import { bills } from '../repositories/data.js'
import { parseAcceptanceExcel, parseSettlementSheet } from '../services/excel.js'
import {
  listBills, getBillDetail, createBill, updateBill, deleteBill,
  confirmBill, rejectBill, resubmitBill, billStats, exportBillsCsv, calculateBill, previewFormula,
  computeSupplierConfirmedTotal, checkTotalSubmission, costCenterReport, saveBillAttachment,
  assignEngineer, listEngineers, listSupplierNames, settlementSummary, urgeBill, resubmitSettlement
} from '../services/bills.js'
import { FORMULA_VARS, DEFAULT_FORMULA } from '../lib/formula.js'

export async function financeRouter(ctx) {
  const { req, res, url, pathname, user } = ctx
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  // ===== 确认链配置（后端为权威，前端仅展示） =====
  if (is('GET', '/api/finance/stages')) {
    ok(res, {
      stages: BILL_STAGES.map(s => ({ key: s.key, label: s.label, roleType: s.roleType })),
      statusLabels: BILL_STATUS
    })
    return true
  }

  // ===== 验收数据导入解析（供应商上传 Excel/CSV，返回预览行） =====
  if (is('POST', '/api/finance/bills/parse')) {
    ok(res, await parseAcceptanceExcel(user, await body()))
    return true
  }

  // ===== 附件留存：上传产出明细表等原始文件（返回可写入单据的引用） =====
  if (is('POST', '/api/finance/attachments')) {
    ok(res, saveBillAttachment(user, await body()))
    return true
  }

  // ===== 附件下载：带归属与数据范围校验（供应商只能下自己单据的附件）=====
  const attachDownload = m(/^\/api\/finance\/attachments\/download\/(.+)$/)
  if (attachDownload && req.method === 'GET') {
    const storedName = decodeURIComponent(attachDownload[1])
    const bill = bills.find(b => (b.attachments || []).some(a => a.storedName === storedName))
    if (!bill) throw new ApiError(404, 'NOT_FOUND', '附件不存在')
    assertSupplierVisible(user, bill)
    const attachment = (bill.attachments || []).find(a => a.storedName === storedName)
    const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')
    streamDownload(res, uploadsRoot, storedName, attachment?.originalName || path.basename(storedName))
    return true
  }

  // ===== 待结算单导入解析（识别列 + 建议结算公式） =====
  if (is('POST', '/api/finance/bills/parse-settlement')) {
    ok(res, await parseSettlementSheet(user, await body()))
    return true
  }

  // ===== 结算公式：可用变量 / 校验与试算 =====
  if (is('GET', '/api/finance/formula')) {
    ok(res, { defaultFormula: DEFAULT_FORMULA, variables: FORMULA_VARS })
    return true
  }
  if (is('POST', '/api/finance/formula/preview')) {
    ok(res, previewFormula(user, await body()))
    return true
  }

  // ===== 结算单明细级对账导出 =====
  if (is('GET', '/api/finance/export')) {
    const csv = await exportBillsCsv(user, url.searchParams)
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(csv.fileName)}"`
    })
    res.end(csv.content)
    return true
  }

  // ===== 成本中心报表（按占比分摊后的金额汇总，供出报表） =====
  if (is('GET', '/api/finance/settlement/cost-centers')) {
    ok(res, costCenterReport(user, {
      period: url.searchParams.get('period') || '',
      projectId: url.searchParams.get('projectId') || 0,
      dateFrom: url.searchParams.get('dateFrom') || '',
      dateTo: url.searchParams.get('dateTo') || ''
    }))
    return true
  }

  // ===== 统一结算：供应商确认金额合计（供统结方录入总金额时参考） =====
  if (is('GET', '/api/finance/settlement/supplier-total')) {
    ok(res, computeSupplierConfirmedTotal({
      period: url.searchParams.get('period') || '',
      projectId: url.searchParams.get('projectId') || 0,
      supplierNames: url.searchParams.getAll('supplierName').map(x => String(x).trim()).filter(Boolean)
    }))
    return true
  }
  // ===== 统一结算：提交总金额（增幅超 3.5% → 报警且拦截） =====
  if (is('POST', '/api/finance/settlement/submit-total')) {
    ok(res, checkTotalSubmission(user, await body()))
    return true
  }

  // ===== 看板统计 =====
  if (is('GET', '/api/finance/stats')) { ok(res, billStats(user)); return true }

  // ===== 结算单列表 / 创建 =====
  if (is('GET', '/api/finance/bills')) {
    const { items, total, page, pageSize } = listBills(user, url.searchParams)
    ok(res, items, { total, page, pageSize })
    return true
  }
  if (is('POST', '/api/finance/bills')) { created(res, await createBill(user, await body())); return true }

  // ===== 结算单详情 / 修改 / 删除 =====
  const billItem = m(/^\/api\/finance\/bills\/(\d+)$/)
  if (billItem) {
    const id = Number(billItem[1])
    if (req.method === 'GET') { ok(res, await getBillDetail(user, id)); return true }
    if (req.method === 'PUT') { ok(res, await updateBill(user, id, await body())); return true }
    if (req.method === 'DELETE') { ok(res, await deleteBill(user, id)); return true }
  }

  // ===== 确认流动作 =====
  // ===== 可指派的工程师名单（财务指派用）=====
  if (is('GET', '/api/finance/engineers')) { ok(res, listEngineers(user)); return true }

  // ===== 结算汇总看板（供应商管理页）：累积结算 + 成本中心分布 + 周期累积 =====
  if (is('GET', '/api/finance/settlement-summary')) {
    ok(res, settlementSummary(user, {
      period: url.searchParams.get('period') || '',
      projectId: url.searchParams.get('projectId') || 0,
      dateFrom: url.searchParams.get('dateFrom') || '',
      dateTo: url.searchParams.get('dateTo') || ''
    }))
    return true
  }

  // ===== 供应商姓名清单（甲方PM 代建单时选供应商；口径=姓名）=====
  if (is('GET', '/api/finance/supplier-names')) { ok(res, listSupplierNames(user)); return true }

  // ===== 指派工程师（财务）：供应商提交后由财务指定本项目的数据确认人 =====
  const assign = m(/^\/api\/finance\/bills\/(\d+)\/assign$/)
  if (assign && req.method === 'POST') { ok(res, await assignEngineer(user, Number(assign[1]), await body())); return true }

  // ===== 统结方重新提交统结数据（停在统结方/财务二次确认时可改正）=====
  const reSettle = m(/^\/api\/finance\/bills\/(\d+)\/resubmit-settlement$/)
  if (reSettle && req.method === 'POST') { ok(res, await resubmitSettlement(user, Number(reSettle[1]), await body())); return true }

  // ===== 加急催办：催当前环节的处理人 =====
  const urge = m(/^\/api\/finance\/bills\/(\d+)\/urge$/)
  if (urge && req.method === 'POST') { ok(res, await urgeBill(user, Number(urge[1]), await body())); return true }

  const action = m(/^\/api\/finance\/bills\/(\d+)\/(confirm|reject|resubmit|calculate)$/)
  if (action && req.method === 'POST') {
    const id = Number(action[1])
    if (action[2] === 'confirm') { ok(res, await confirmBill(user, id, await body())); return true }
    if (action[2] === 'reject') { ok(res, await rejectBill(user, id, await body())); return true }
    if (action[2] === 'calculate') { ok(res, await calculateBill(user, id, await body())); return true }
    ok(res, await resubmitBill(user, id)); return true
  }

  return false
}
