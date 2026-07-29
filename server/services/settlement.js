import { ApiError } from '../lib/http.js'
import { tasks, taskItems, settlements, suppliers, auditLogs } from '../repositories/data.js'
import { nowText, todayText } from '../lib/time.js'

// 阶梯质量绩效系数（PRD 4.4）：
// FFR >= 98% -> 1.2 奖励；95%~98% -> 1.0；90%~95% -> 0.8 惩罚；< 90% -> 整包打回不予结算
export function qualityCoefficient(ffr) {
  if (ffr >= 0.98) return 1.2
  if (ffr >= 0.95) return 1.0
  if (ffr >= 0.9) return 0.8
  return 0
}

export function calcTaskSettlement(taskId) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在')
  if (!task.supplierId) throw new ApiError(422, 'VALIDATION_ERROR', '任务尚未指派供应商')
  const items = taskItems.filter(i => i.taskId === taskId)
  const reviewed = items.filter(i => i.clientReviewed)
  if (reviewed.length === 0) throw new ApiError(422, 'VALIDATION_ERROR', '该任务尚无甲方质检记录，无法结算')
  const firstPassCount = reviewed.filter(i => i.firstPass).length
  const ffr = firstPassCount / reviewed.length
  const coef = qualityCoefficient(ffr)
  const validCount = items.filter(i => i.status === 'accepted').length
  const baseAmount = task.unitPrice * validCount
  const amount = coef === 0 ? 0 : Number((baseAmount * coef).toFixed(2))
  return {
    task, items, reviewedCount: reviewed.length, firstPassCount,
    ffr: Number(ffr.toFixed(4)), coef, validCount,
    unitPrice: task.unitPrice, baseAmount: Number(baseAmount.toFixed(2)), amount,
    rejected: coef === 0
  }
}

// 生成结算单（甲方 PM）
export function generateSettlement(user, body) {
  if (user.roleType !== 1) throw new ApiError(403, 'FORBIDDEN', '仅甲方 PM 可生成结算单')
  const taskId = Number(body.taskId)
  const calc = calcTaskSettlement(taskId)

  const exists = settlements.find(s => s.taskId === taskId && s.status !== 'CANCELLED')
  if (exists) throw new ApiError(409, 'STATE_CONFLICT', '该任务已存在结算单 ' + exists.billNo)

  const billNo = 'BILL' + todayText().replace(/-/g, '') + String(settlements.length + 1).padStart(4, '0')
  const settlement = {
    id: settlements.length + 1, billNo,
    taskId, taskName: calc.task.taskName,
    supplierId: calc.task.supplierId, supplierName: calc.task.supplierName,
    unitPrice: calc.unitPrice, validCount: calc.validCount,
    reviewedCount: calc.reviewedCount, firstPassCount: calc.firstPassCount,
    ffr: calc.ffr, coef: calc.coef,
    baseAmount: calc.baseAmount, amount: calc.amount,
    rejected: calc.rejected,
    status: calc.rejected ? 'REJECTED' : 'PENDING',
    confirms: [],
    createTime: nowText(), createBy: user.userName
  }
  settlements.push(settlement)
  auditLogs.push({ action: 'settlement.generate', actorId: user.id, taskId, billNo, at: nowText() })
  return settlement
}

export function listSettlements(user) {
  // 数据隔离：供应商仅看本团队账单
  let list = settlements
  if ([3, 4, 5].includes(user.roleType)) list = list.filter(s => s.supplierId === user.supplierId)
  return list.slice().sort((a, b) => b.id - a.id)
}

// 在线确认：甲方 PM 与供应商 TL 双方确认后转为 SETTLED（PRD 4.4 对账）
export function confirmSettlement(user, id) {
  const s = settlements.find(item => item.id === id)
  if (!s) throw new ApiError(404, 'NOT_FOUND', '结算单不存在')
  const isPm = user.roleType === 1
  const isVendorTl = user.roleType === 3 && user.supplierId === s.supplierId
  if (!isPm && !isVendorTl) throw new ApiError(403, 'FORBIDDEN', '仅甲方 PM 或该供应商团队长可确认')
  if (s.status === 'REJECTED') throw new ApiError(409, 'STATE_CONFLICT', '该结算单已因质量不合格打回，不可确认')
  if (s.status === 'SETTLED') return s

  const side = isPm ? 'CLIENT' : 'VENDOR'
  if (!s.confirms.some(c => c.side === side)) {
    s.confirms.push({ side, userName: user.userName, time: nowText() })
  }
  s.status = s.confirms.length >= 2 ? 'SETTLED' : 'CONFIRMING'
  auditLogs.push({ action: 'settlement.confirm', actorId: user.id, billNo: s.billNo, side, at: nowText() })
  return s
}

// 导出 CSV（对账单）
export function exportSettlementCsv(user, id) {
  const s = settlements.find(item => item.id === id)
  if (!s) throw new ApiError(404, 'NOT_FOUND', '结算单不存在')
  if ([3, 4, 5].includes(user.roleType) && s.supplierId !== user.supplierId) {
    throw new ApiError(403, 'FORBIDDEN', '无权导出他人账单')
  }
  const rows = [
    ['结算单号', s.billNo],
    ['任务名称', s.taskName],
    ['供应商', s.supplierName],
    ['基础单价(元/条)', s.unitPrice],
    ['有效标注量(条)', s.validCount],
    ['质检条数', s.reviewedCount],
    ['一次通过条数', s.firstPassCount],
    ['一次通过率FFR', (s.ffr * 100).toFixed(2) + '%'],
    ['质量绩效系数', s.coef],
    ['基础金额(元)', s.baseAmount],
    ['结算金额(元)', s.amount],
    ['状态', s.rejected ? '整包打回(FFR<90%)' : s.status],
    ['生成时间', s.createTime],
    ['确认记录', s.confirms.map(c => `${c.side === 'CLIENT' ? '甲方' : '供应商'}:${c.userName}@${c.time}`).join(' | ') || '无']
  ]
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  return { fileName: s.billNo + '.csv', content: csv }
}

// 供应商统计（看板用）：FFR、平均返工耗时、验收量
export function supplierQualityStats() {
  return suppliers.map(sup => {
    const supTasks = tasks.filter(t => t.supplierId === sup.id)
    const taskIds = new Set(supTasks.map(t => t.id))
    const items = taskItems.filter(i => taskIds.has(i.taskId))
    const reviewed = items.filter(i => i.clientReviewed)
    const firstPass = reviewed.filter(i => i.firstPass).length
    const ffr = reviewed.length ? firstPass / reviewed.length : null
    const reworkItems = items.filter(i => (i.reworkCount || 0) > 0)
    const avgReworkSecs = reworkItems.length
      ? reworkItems.reduce((sum, i) => sum + (i.workSeconds || 0), 0) / reworkItems.length / 3600
      : 0
    const settled = settlements.filter(s => s.supplierId === sup.id && s.status === 'SETTLED')
      .reduce((sum, s) => sum + s.amount, 0)
    return {
      supplierId: sup.id, name: sup.name,
      reviewedCount: reviewed.length, firstPassCount: firstPass,
      ffr: ffr === null ? null : Number(ffr.toFixed(4)),
      acceptedCount: items.filter(i => i.status === 'accepted').length,
      reworkBacklog: items.filter(i => i.isRework).length,
      avgReworkHours: Number(avgReworkSecs.toFixed(2)),
      settledAmount: Number(settled.toFixed(2))
    }
  })
}
