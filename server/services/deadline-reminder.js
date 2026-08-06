import { tasks } from '../repositories/data.js'
import { createNotification } from './notifications.js'

const REMIND_DAYS = 2
const checkIntervalMs = 30 * 60 * 1000 // 每30分钟检查一次

function daysUntil(deadline) {
  if (!deadline) return null
  const dl = new Date(String(deadline).replace(/-/g, '/')).getTime()
  if (isNaN(dl)) return null
  return (dl - Date.now()) / (24 * 60 * 60 * 1000)
}

// 扫描任务，对距离截止时间 2 天的未完成/未验收任务推送提醒
function checkDeadline() {
  const nowText = new Date().toLocaleString('zh-CN', { hour12: false })
  tasks.forEach(task => {
    // 已完成或已归档的任务无需提醒
    if (['ACCEPTED', 'ARCHIVED', 'REJECTED'].includes(task.state)) return
    const days = daysUntil(task.deadline)
    if (days === null || days > REMIND_DAYS) return
    if (task.deadlineReminded) return // 已提醒过，避免重复

    // 距离截止 2 天及以内才提醒
    if (days <= REMIND_DAYS) {
      task.deadlineReminded = true
      const remain = days <= 0
        ? '已逾期'
        : `剩余约 ${Math.ceil(days)} 天`
      createNotification(
        null,
        'task',
        '任务截止提醒',
        `「${task.taskName}」距离截止时间${remain}\n截止时间：${task.deadline}\n当前状态：${task.state}\n请及时完成标注、质检与提交。\n\n> 提醒时间：${nowText}`,
        'task',
        task.id
      )
    }
  })
}

// 启动定时扫描
export function startDeadlineReminder() {
  checkDeadline()
  setInterval(checkDeadline, checkIntervalMs).unref()
  console.log('截止时间提醒任务已启动（每30分钟检查一次，提前2天提醒）')
}
