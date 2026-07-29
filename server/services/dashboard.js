import { projects, tasks, taskLogs, taskItems, workSessions, settlements, users, ERROR_TYPES } from '../repositories/data.js'
import { supplierQualityStats } from './settlement.js'

const errLabel = v => (ERROR_TYPES.find(t => t.value === v) || {}).label || v

export function getDashboardData(user) {
  const isVendor = [3, 4, 5].includes(user.roleType)
  const visibleTasks = isVendor ? tasks.filter(t => t.supplierId === user.supplierId) : tasks
  const taskIds = new Set(visibleTasks.map(t => t.id))
  const items = taskItems.filter(i => taskIds.has(i.taskId))

  // 数据流隔离（PRD：标注员 → 供应商 → 甲方 → 算法）
  // 算法工程师仅见甲方验收通过(accepted)的最终数据，不见供应商标注过程
  const analysisItems = user.roleType === 6 ? items.filter(i => i.status === 'accepted') : items

  // ---- 基础指标（全角色）----
  const statusCount = {}
  visibleTasks.forEach(t => { statusCount[t.state] = (statusCount[t.state] || 0) + 1 })
  const overdueTasks = visibleTasks.filter(t => {
    if (!t.deadline || ['ACCEPTED', 'ARCHIVED'].includes(t.state)) return false
    return new Date(t.deadline.replace(/-/g, '/')).getTime() < Date.now()
  }).length
  const itemsByStatus = {
    unassigned: (statusCount.UNASSIGNED || 0) + (statusCount.DRAFT || 0),
    annotating: statusCount.ANNOTATING || 0,
    vendorQA: statusCount.VENDOR_QA || 0,
    clientQA: statusCount.CLIENT_QA || 0,
    accepted: statusCount.ACCEPTED || 0,
    rejected: statusCount.REJECTED || 0,
    overdue: overdueTasks
  }
  const recentTasks = visibleTasks.slice().sort((a, b) => b.id - a.id).slice(0, 10).map(t => ({
    id: t.id, taskName: t.taskName, state: t.state, deadline: t.deadline,
    supplierName: t.supplierName, nanoId: t.nanoId
  }))
  const recentLogs = taskLogs.slice().sort((a, b) => b.time?.localeCompare(a.time) || 0).slice(0, 8)

  // ---- 明细级吞吐（数据条目维度）----
  const itemStatusCount = {}
  analysisItems.forEach(i => { itemStatusCount[i.status] = (itemStatusCount[i.status] || 0) + 1 })

  // ---- 错误分类 Top（PRD 4.3 TL 看板 Top3 / PM 全局）----
  const errorCount = {}
  analysisItems.forEach(i => (i.errorTypes || []).forEach(t => { errorCount[t] = (errorCount[t] || 0) + 1 }))
  analysisItems.forEach(i => (i.history || []).forEach(h => (h.errorTypes || []).forEach(t => { errorCount[t] = (errorCount[t] || 0) + 1 })))
  const errorTop = Object.entries(errorCount).map(([k, v]) => ({ name: errLabel(k), value: v }))
    .sort((a, b) => b.value - a.value).slice(0, 6)

  const data = {
    roleType: user.roleType,
    projectCount: isVendor ? new Set(visibleTasks.map(t => t.projectId)).size : projects.length,
    totalTasks: visibleTasks.length,
    itemsByStatus, itemStatusCount, errorTop, recentTasks, recentLogs,
    reworkBacklog: analysisItems.filter(i => i.isRework).length
  }

  // ---- 甲方 PM/质检视角：供应商质量排行 + 成本预算（算法不可见供应商质量数据）----
  if ([1, 2].includes(user.roleType)) {
    data.supplierRanking = supplierQualityStats()
    const settledSum = settlements.filter(s => s.status === 'SETTLED').reduce((sum, s) => sum + s.amount, 0)
    const pipelineSum = settlements.filter(s => ['PENDING', 'CONFIRMING'].includes(s.status)).reduce((sum, s) => sum + s.amount, 0)
    data.costStats = {
      settled: Number(settledSum.toFixed(2)),
      pipeline: Number(pipelineSum.toFixed(2)),
      budget: 100000,
      usageRate: Number(((settledSum + pipelineSum) / 100000 * 100).toFixed(1))
    }
  }

  // ---- 供应商 TL 视角：团队人效排行 ----
  if (isVendor) {
    const supUsers = users.filter(u => u.supplierId === user.supplierId && u.roleType === 4)
    data.teamPerf = supUsers.map(u => {
      const secs = workSessions.filter(w => w.userId === u.id).reduce((sum, w) => sum + w.seconds, 0)
      const submitted = items.filter(i => i.claimedBy === u.id && (i.submitCount || 0) > 0).length
      const hours = secs / 3600
      const myReviewed = items.filter(i => i.claimedBy === u.id && i.clientReviewed)
      const myFirstPass = myReviewed.filter(i => i.firstPass).length
      return {
        userId: u.id, userName: u.userName,
        hours: Number(hours.toFixed(2)), submitted,
        perHour: hours > 0 ? Number((submitted / hours).toFixed(1)) : 0,
        ffr: myReviewed.length ? Number((myFirstPass / myReviewed.length * 100).toFixed(1)) : null,
        reworkCount: items.filter(i => i.claimedBy === u.id && i.isRework).length
      }
    }).sort((a, b) => b.submitted - a.submitted)
  }

  // ---- 算法工程师视角：数据资产（标签分布，仅统计验收数据）----
  if (user.roleType === 6 || user.roleType === 1) {
    const labelCount = {}
    analysisItems.forEach(i => ((i.annotation || {}).boxes || []).forEach(b => {
      if (b.label) labelCount[b.label] = (labelCount[b.label] || 0) + 1
    }))
    data.labelDist = Object.entries(labelCount).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }

  return data
}
