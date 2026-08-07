// 工作台路由（需鉴权）：标注/质检工作台、防挂机计时、结算
import { config } from '../config.js'
import { created, ok, readJson } from '../lib/http.js'
import {
  getWorkbenchQueue, claimItem, claimQaTask, releaseQaTask, saveAnnotation,
  submitItem, vendorQaItem, clientQaItem, batchQaItems
} from '../services/workbench.js'
import { heartbeat, myTiming } from '../services/timing.js'
import { generateSettlement, listSettlements, confirmSettlement, exportSettlementCsv } from '../services/settlement.js'

export async function workbenchRouter(ctx) {
  const { req, res, url, pathname, user } = ctx
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  // ===== 标注工作台 =====
  const workbench = m(/^\/api\/tasks\/(\d+)\/workbench$/)
  if (workbench && req.method === 'GET') { ok(res, getWorkbenchQueue(user, Number(workbench[1]))); return true }

  const claim = m(/^\/api\/items\/(\d+)\/claim$/)
  if (claim && req.method === 'POST') { ok(res, claimItem(user, Number(claim[1]))); return true }

  const qaClaim = m(/^\/api\/tasks\/(\d+)\/qa-claim$/)
  if (qaClaim && req.method === 'POST') { ok(res, claimQaTask(user, Number(qaClaim[1]))); return true }

  const qaRelease = m(/^\/api\/tasks\/(\d+)\/qa-release$/)
  if (qaRelease && req.method === 'POST') { ok(res, releaseQaTask(user, Number(qaRelease[1]))); return true }

  const annotation = m(/^\/api\/items\/(\d+)\/annotation$/)
  if (annotation && req.method === 'PUT') { ok(res, saveAnnotation(user, Number(annotation[1]), await body())); return true }

  const itemSubmit = m(/^\/api\/items\/(\d+)\/submit$/)
  if (itemSubmit && req.method === 'POST') { ok(res, submitItem(user, Number(itemSubmit[1]))); return true }

  const vendorQa = m(/^\/api\/items\/(\d+)\/vendor-qa$/)
  if (vendorQa && req.method === 'POST') { ok(res, vendorQaItem(user, Number(vendorQa[1]), await body())); return true }

  const clientQa = m(/^\/api\/items\/(\d+)\/client-qa$/)
  if (clientQa && req.method === 'POST') { ok(res, clientQaItem(user, Number(clientQa[1]), await body())); return true }

  if (is('POST', '/api/items/batch-vendor-qa')) { ok(res, batchQaItems(user, await body(), 'vendor')); return true }
  if (is('POST', '/api/items/batch-client-qa')) { ok(res, batchQaItems(user, await body(), 'client')); return true }

  // ===== 防挂机工时 =====
  if (is('POST', '/api/timing/heartbeat')) { ok(res, heartbeat(user, await body())); return true }
  if (is('GET', '/api/timing/my')) { ok(res, myTiming(user)); return true }

  // ===== 结算 =====
  if (is('GET', '/api/settlements')) { ok(res, listSettlements(user)); return true }
  if (is('POST', '/api/settlements/generate')) { created(res, generateSettlement(user, await body())); return true }

  const confirm = m(/^\/api\/settlements\/(\d+)\/confirm$/)
  if (confirm && req.method === 'POST') { ok(res, confirmSettlement(user, Number(confirm[1]))); return true }

  const exportCsv = m(/^\/api\/settlements\/(\d+)\/export$/)
  if (exportCsv && req.method === 'GET') {
    const csv = exportSettlementCsv(user, Number(exportCsv[1]))
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(csv.fileName)}"`
    })
    res.end(csv.content)
    return true
  }
  return false
}
