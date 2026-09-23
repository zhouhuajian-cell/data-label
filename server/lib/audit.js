// 操作审计：统一写入入口。
// 目标：任何敏感操作都能查到「谁 / 什么时候 / 对谁 / 做了什么」，且具体到人。
//
// 字段约定：
//   action                 操作类型（模块.动作，如 user.update）
//   actorId / actorName    操作人（姓名冗余存储：账号改名、停用后仍可追溯）
//   targetId / targetName  被操作对象（账号/项目/单据等，无则为空）
//   at                     发生时间
//   ...detail              其余细节（变更前后、金额、原因、环节等）
//
// 注意：仓储层是内存集合 + 防抖落盘（store.js），这里直接 push 即可，
// 与既有 auditLogs 的写入方式保持一致。
import { auditLogs } from '../repositories/data.js'
import { nowText } from './time.js'

export function writeAudit (action, actor, target = null, detail = {}) {
  auditLogs.push({
    action,
    actorId: actor?.id ?? null,
    actorName: actor?.userName || actor?.username || '系统',
    targetId: target?.id ?? null,
    targetName: target?.userName || target?.name || '',
    at: nowText(),
    ...detail
  })
}

// 对比前后快照，返回发生变化的字段名（用于只在确有变化时记录，避免无变化提交刷屏）
export function changedFields (before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return [...keys].filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
}
