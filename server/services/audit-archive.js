// 审计日志归档
//
// 策略：主列表（auditLogs 集合）只保留最近 N 个月（默认 3 个月，AUDIT_KEEP_MONTHS 可调），
// 更早的记录按月导出成 gzip JSONL 文件后从集合中移除。
//
// 为什么必须移出而不是留着：
//   auditLogs 是 app_state 里的一个 JSON 集合，store.js 每次保存都会**全量重写**该集合，
//   而审计日志只增不减 —— 越积越大 → 每次业务写入都越来越慢（稳定性评估里提到的写放大）。
//
// 归档文件：<项目>/archive/audit-<月份>-<归档时间>.jsonl.gz，一行一条 JSON，可用 zcat/gunzip 查看。
// 目录需 systemd 的 ReadWritePaths 授权（见 deploy/data-label.service）。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { auditLogs } from '../repositories/data.js'

const KEEP_MONTHS = (() => {
  const n = Number(process.env.AUDIT_KEEP_MONTHS || 3)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3
})()

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../archive')
export const ARCHIVE_DIR = process.env.AUDIT_ARCHIVE_DIR || DEFAULT_DIR

const pad = (n) => String(n).padStart(2, '0')

// 保留期起点：保留「含当月在内的最近 KEEP_MONTHS 个自然月」，更早的归档。
// 因此起点是当月往前推 (KEEP_MONTHS - 1) 个月的第一天 00:00:00 ——
// 例：9 月、KEEP_MONTHS=3 → 保留 7/8/9 月，起点 2026-07-01。
// （时间戳统一是 'YYYY-MM-DD HH:mm:ss'，可直接字符串比较）
export function archiveCutoff (now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - (KEEP_MONTHS - 1), 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01 00:00:00`
}


// 执行归档；幂等：没有超期记录时什么都不做（返回 archived: 0）
export function archiveOldAuditLogs ({ now = new Date() } = {}) {
  const cutoff = archiveCutoff(now)
  const overdue = auditLogs.filter(l => String(l.at || '') < cutoff)
  if (!overdue.length) return { archived: 0, files: [], cutoff, dir: ARCHIVE_DIR }

  // 按月分组，便于按月取回
  const byMonth = {}
  for (const l of overdue) {
    const month = String(l.at || '').slice(0, 7) || 'unknown'
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(l)
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  const files = []
  for (const [month, list] of Object.entries(byMonth)) {
    // 一个月一个文件：已有该月文件时先解压出来合并，避免重复归档时覆盖丢数据
    const file = path.join(ARCHIVE_DIR, `audit-${month}.jsonl.gz`)
    let existing = ''
    if (fs.existsSync(file)) {
      try { existing = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') } catch { existing = '' }
    }
    const added = list.map(l => JSON.stringify(l)).join('\n') + '\n'
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(existing + added, 'utf8')))
    files.push({ file, month, count: list.length })
  }

  // 从内存集合移除（落盘由 store.js 的防抖机制完成）
  const keep = auditLogs.filter(l => String(l.at || '') >= cutoff)
  auditLogs.splice(0, auditLogs.length, ...keep)

  return { archived: overdue.length, files, cutoff, dir: ARCHIVE_DIR, kept: keep.length }
}

// 服务启动时调用一次，并按天重复；返回的函数可用于取消（测试用）
export function startAuditArchiveScheduler (intervalMs = 24 * 3600 * 1000) {
  const run = () => {
    try {
      const r = archiveOldAuditLogs()
      if (r.archived) {
        console.log(`审计日志归档：${r.archived} 条（保留期起点 ${r.cutoff}）→ ${r.files.map(f => path.basename(f.file)).join('、')}`)
      }
    } catch (e) {
      // 归档失败不影响服务（下次再试），但要在日志里留痕
      console.error('审计日志归档失败：', e.message)
    }
  }
  run()
  const timer = setInterval(run, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}
