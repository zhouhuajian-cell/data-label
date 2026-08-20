// GND 域路由：公开端点（登录/注册）→ gndRequireAuth → PENDING 限制 → 业务端点
import { ApiError, created, ok, readJson } from '../lib/http.js'
import { config } from '../config.js'
import { gndRequireAuth } from '../lib/gnd-jwt.js'
import { loginByPassword, loginByFeishu, me, changePassword } from '../services/gnd-auth.js'
import { listUsers, approveUser, rejectUser, disableUser, listSuppliers, createSupplier } from '../services/gnd-users.js'
import { createTask, listTasks, getTaskDetail, updateTask, voidTask } from '../services/gnd-tasks.js'
import { receiveTask, submitTask, cancelSubmit } from '../services/gnd-submission.js'
import { startOptimization, skipOptimization, completeOptimization } from '../services/gnd-optimization.js'
import { acceptance, revertAcceptance } from '../services/gnd-acceptance.js'
import { warehouse, warehouseRecover } from '../services/gnd-warehouse.js'
import { updatePerception, repair, repairCancel } from '../services/gnd-perception.js'
import { getOptions, setOptions } from '../lib/gnd-options.js'
import { getOverview, exportCsv } from '../services/gnd-stats.js'

export async function gndRouter({ req, res, url, pathname }) {
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  // ===== 公开端点（无需鉴权）=====
  if (is('POST', '/api/gnd/auth/login')) { ok(res, loginByPassword(await body())); return true }
  if (is('POST', '/api/gnd/auth/feishu')) { ok(res, loginByFeishu(await body())); return true }

  // ===== GND 独立鉴权 =====
  const user = gndRequireAuth(req)
  const ctx = { req, res, url, pathname, user }
  const bodyFor = async () => await body()

  // PENDING 用户仅可访问 /auth/me（其余业务接口一律拒绝）
  if (user.status !== 'ACTIVE' && pathname !== '/api/gnd/auth/me') {
    throw new ApiError(403, 'GND_USER_PENDING', '账号待管理员审批')
  }

  // ===== 认证 =====
  if (is('GET', '/api/gnd/auth/me')) { ok(res, me(user)); return true }
  if (is('PUT', '/api/gnd/auth/password')) { ok(res, changePassword(user, await bodyFor())); return true }

  // ===== 用户与供应商 =====
  if (is('GET', '/api/gnd/users')) { const r = listUsers(user, url.searchParams); ok(res, r.items, { total: r.total, page: r.page, pageSize: r.pageSize }); return true }
  const approve = m(/^\/api\/gnd\/users\/(\d+)\/approve$/)
  if (approve && req.method === 'PUT') { ok(res, approveUser(user, Number(approve[1]), await bodyFor())); return true }
  const reject = m(/^\/api\/gnd\/users\/(\d+)\/reject$/)
  if (reject && req.method === 'PUT') { ok(res, rejectUser(user, Number(reject[1]))); return true }
  const disable = m(/^\/api\/gnd\/users\/(\d+)\/disable$/)
  if (disable && req.method === 'PUT') { ok(res, disableUser(user, Number(disable[1]), await bodyFor())); return true }

  if (is('GET', '/api/gnd/suppliers')) { ok(res, listSuppliers(user, url.searchParams)); return true }
  if (is('POST', '/api/gnd/suppliers')) { created(res, createSupplier(user, await bodyFor())); return true }

  // ===== 测区任务 =====
  if (is('GET', '/api/gnd/tasks')) { const r = listTasks(user, url.searchParams); ok(res, r.items, { total: r.total, page: r.page, pageSize: r.pageSize }); return true }
  if (is('POST', '/api/gnd/tasks')) { created(res, createTask(user, await bodyFor())); return true }

  const taskId = m(/^\/api\/gnd\/tasks\/(\d+)$/)
  if (taskId && req.method === 'GET') { ok(res, getTaskDetail(user, Number(taskId[1]))); return true }
  if (taskId && req.method === 'PUT') { ok(res, updateTask(user, Number(taskId[1]), await bodyFor())); return true }

  // ===== 状态流转 =====
  const receive = m(/^\/api\/gnd\/tasks\/(\d+)\/receive$/)
  if (receive && req.method === 'POST') { ok(res, receiveTask(user, Number(receive[1]))); return true }
  const submit = m(/^\/api\/gnd\/tasks\/(\d+)\/submit$/)
  if (submit && req.method === 'POST') { ok(res, submitTask(user, Number(submit[1]), await bodyFor())); return true }
  const submitCancel = m(/^\/api\/gnd\/tasks\/(\d+)\/submit\/cancel$/)
  if (submitCancel && req.method === 'POST') { ok(res, cancelSubmit(user, Number(submitCancel[1]))); return true }
  const voidTaskM = m(/^\/api\/gnd\/tasks\/(\d+)\/void$/)
  if (voidTaskM && req.method === 'POST') { ok(res, voidTask(user, Number(voidTaskM[1]), await bodyFor())); return true }

  const optStart = m(/^\/api\/gnd\/tasks\/(\d+)\/optimization\/start$/)
  if (optStart && req.method === 'POST') { ok(res, startOptimization(user, Number(optStart[1]), await bodyFor())); return true }
  const optSkip = m(/^\/api\/gnd\/tasks\/(\d+)\/optimization\/skip$/)
  if (optSkip && req.method === 'POST') { ok(res, skipOptimization(user, Number(optSkip[1]), await bodyFor())); return true }
  const optComplete = m(/^\/api\/gnd\/tasks\/(\d+)\/optimization\/complete$/)
  if (optComplete && req.method === 'POST') { ok(res, completeOptimization(user, Number(optComplete[1]), await bodyFor())); return true }

  const acc = m(/^\/api\/gnd\/tasks\/(\d+)\/acceptance$/)
  if (acc && req.method === 'POST') { ok(res, acceptance(user, Number(acc[1]), await bodyFor())); return true }
  const accRevert = m(/^\/api\/gnd\/tasks\/(\d+)\/acceptance\/revert$/)
  if (accRevert && req.method === 'POST') { ok(res, revertAcceptance(user, Number(accRevert[1]), await bodyFor())); return true }

  const wh = m(/^\/api\/gnd\/tasks\/(\d+)\/warehouse$/)
  if (wh && req.method === 'POST') { ok(res, warehouse(user, Number(wh[1]), await bodyFor())); return true }
  const whRecover = m(/^\/api\/gnd\/tasks\/(\d+)\/warehouse\/recover$/)
  if (whRecover && req.method === 'POST') { ok(res, warehouseRecover(user, Number(whRecover[1]), await bodyFor())); return true }

  const percep = m(/^\/api\/gnd\/tasks\/(\d+)\/perception$/)
  if (percep && req.method === 'PUT') { ok(res, updatePerception(user, Number(percep[1]), await bodyFor())); return true }
  const repairM = m(/^\/api\/gnd\/tasks\/(\d+)\/repair$/)
  if (repairM && req.method === 'POST') { ok(res, repair(user, Number(repairM[1]), await bodyFor())); return true }
  const repairCancelM = m(/^\/api\/gnd\/tasks\/(\d+)\/repair\/cancel$/)
  if (repairCancelM && req.method === 'POST') { ok(res, repairCancel(user, Number(repairCancelM[1]))); return true }

  // ===== 枚举配置 =====
  if (is('GET', '/api/gnd/options')) { ok(res, getOptions(url.searchParams.get('category'))); return true }
  const optionsCat = m(/^\/api\/gnd\/options\/([A-Z_]+)$/)
  if (optionsCat && req.method === 'PUT') { ok(res, setOptions(optionsCat[1], (await bodyFor()).items)); return true }

  // ===== 统计与导出 =====
  if (is('GET', '/api/gnd/stats/overview')) { ok(res, getOverview(user, url.searchParams)); return true }
  if (is('GET', '/api/gnd/stats/export')) {
    const out = exportCsv(user, url.searchParams)
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(out.fileName)}"`
    })
    res.end(out.csv)
    return true
  }

  return false
}
