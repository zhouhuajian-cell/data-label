import { ApiError } from '../lib/http.js'
import { taskItems, workSessions } from '../repositories/data.js'
import { todayText } from '../lib/time.js'

// 防挂机耗时统计（PRD 4.4）：
// 前端监听键鼠动作，连续 3 分钟无操作即暂停计时；
// 每 30 秒心跳上报一次"有效活跃秒数"，后端单段封顶 120 秒，杜绝伪造。
export function heartbeat(user, body) {
  const itemId = Number(body.itemId)
  const item = taskItems.find(i => i.id === itemId)
  if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', '数据明细不存在')
  const sec = Math.min(Math.max(Math.floor(Number(body.activeSeconds) || 0), 0), 120)
  if (sec === 0) return { recorded: 0, total: item.workSeconds || 0 }

  item.workSeconds = (item.workSeconds || 0) + sec
  const today = todayText()
  let sess = workSessions.find(w => w.userId === user.id && w.itemId === itemId && w.date === today)
  if (!sess) {
    sess = { userId: user.id, userName: user.userName, supplierId: user.supplierId, itemId, taskId: item.taskId, date: today, seconds: 0 }
    workSessions.push(sess)
  }
  sess.seconds += sec
  return { recorded: sec, total: item.workSeconds }
}

// 个人工时汇总（标注员"我的人效"）
export function myTiming(user) {
  const sessions = workSessions.filter(w => w.userId === user.id)
  const totalSeconds = sessions.reduce((sum, w) => sum + w.seconds, 0)
  const submitted = taskItems.filter(i => i.claimedBy === user.id && (i.submitCount || 0) > 0).length
  const hours = totalSeconds / 3600
  return {
    totalSeconds,
    hours: Number(hours.toFixed(2)),
    submitted,
    perHour: hours > 0 ? Number((submitted / hours).toFixed(1)) : 0,
    recent: sessions.slice(-20).reverse()
  }
}
