// GND 看板统计与里程导出
import { ApiError } from '../lib/http.js'
import {
  gndTasks, gndSubmissions, gndAcceptances, gndPerceptions,
  gndSuppliers
} from '../repositories/data.js'
import { currentSubmission, supplierName } from './gnd-common.js'

const TAIXING_ADMIN = 8

function requireAdmin(user) {
  if (user.roleType !== TAIXING_ADMIN) throw new ApiError(403, 'FORBIDDEN', '仅泰兴管理员可查看统计')
}

function filterTasks(q) {
  let list = gndTasks.slice()
  const f = (k) => String(q.get(k) || '').trim()
  if (f('city')) list = list.filter(t => t.city === f('city'))
  if (f('supplier_id')) list = list.filter(t => t.supplierId === Number(f('supplier_id')))
  if (f('data_type')) list = list.filter(t => t.dataType === f('data_type'))
  if (f('date_from')) list = list.filter(t => t.createdAt >= f('date_from'))
  if (f('date_to')) list = list.filter(t => t.createdAt <= f('date_to'))
  return list
}

function avgDays(pairs) {
  const days = pairs.filter(([a, b]) => a && b && new Date(b) > new Date(a))
    .map(([a, b]) => (new Date(b) - new Date(a)) / 86400000)
  if (!days.length) return null
  return Number((days.reduce((x, y) => x + y, 0) / days.length).toFixed(1))
}

// ===== 看板总览 =====
export function getOverview(user, q) {
  requireAdmin(user)
  const list = filterTasks(q)
  const statusDistribution = {}
  for (const t of list) statusDistribution[t.status] = (statusDistribution[t.status] || 0) + 1

  const finished = list.filter(t => t.warehousedAt)
  const accepted = list.filter(t => t.acceptedAt)
  const withOptimization = list.filter(t => t.optimizationCompletedAt)

  const avgDurationDays = {
    supplier: avgDays(finished.map(t => [t.receivedAt, t.submittedAt])),
    optimization: avgDays(withOptimization.map(t => [t.submittedAt, t.optimizationCompletedAt])),
    acceptance: avgDays(accepted.map(t => [t.submittedAt, t.acceptedAt])),
    warehouse: avgDays(finished.map(t => [t.acceptedAt, t.warehousedAt])),
    total: avgDays(finished.map(t => [t.createdAt, t.warehousedAt]))
  }

  const acceptanceList = gndAcceptances.filter(a => list.some(t => t.id === a.taskId))
  const rejectCount = acceptanceList.filter(a => a.result === 'REJECTED').length
  const repairCount = gndPerceptions.filter(p => p.repairRequired && list.some(t => t.id === p.taskId)).length

  const mileageList = acceptanceList.filter(a => a.result === 'PASSED')
  const totalMileage = Number(mileageList.reduce((s, a) => s + a.acceptanceMileage, 0).toFixed(3))

  return {
    total: list.length,
    statusDistribution,
    avgDurationDays,
    reworkRate: {
      acceptanceRejectRate: acceptanceList.length ? Number((rejectCount / acceptanceList.length).toFixed(3)) : 0,
      perceptionRepairRate: finished.length ? Number((repairCount / finished.length).toFixed(3)) : 0
    },
    mileageSummary: {
      acceptanceCount: mileageList.length,
      totalMileage,
      avgMileage: mileageList.length ? Number((totalMileage / mileageList.length).toFixed(3)) : 0
    }
  }
}

// ===== 里程结算导出（CSV，仅已验收/已入库且有验收记录）=====
export function exportCsv(user, q) {
  requireAdmin(user)
  const list = filterTasks(q).filter(t => t.acceptedAt)
  const header = ['测区名称', '城市', '车型', '数据类型', '供应商', '供应商里程(km)', '验收里程(km)', '道路场景(验收)', '验收时间', '当前状态']
  const rows = list.map(t => {
    const sub = currentSubmission(t)
    const acc = gndAcceptances.filter(a => a.taskId === t.id).sort((a, b) => a.round - b.round).at(-1)
    return [
      t.measurementAreaName, t.city, t.vehicleModel, t.dataType,
      supplierName(t.supplierId),
      sub ? sub.supplierMileage : '',
      acc ? acc.acceptanceMileage : '',
      acc ? acc.acceptanceRoadScene : '',
      t.acceptedAt || '',
      t.status
    ]
  })
  const esc = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = '\uFEFF' + [header, ...rows].map(r => r.map(esc).join(',')).join('\n')
  return { csv, fileName: 'GND里程结算_' + new Date().toISOString().slice(0, 10) + '.csv' }
}
