// 审计日志归档：主列表保留最近 3 个月，更早的按月导出 gzip 文件后移除
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { config } from '../server/config.js'
config.db.enabled = false
import { auditLogs } from '../server/repositories/data.js'

// 归档目录必须在模块加载前指定（模块内为常量）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-audit-'))
process.env.AUDIT_ARCHIVE_DIR = tmpDir
const { archiveOldAuditLogs, archiveCutoff, ARCHIVE_DIR } = await import('../server/services/audit-archive.js')

const mk = (at, action) => ({ action, actorId: 1, actorName: '某人', at })
const NOW = new Date('2026-09-23T12:00:00')

test('保留期起点：当月往前推 3 个月的第一天', () => {
  assert.equal(archiveCutoff(NOW), '2026-07-01 00:00:00')
  assert.equal(ARCHIVE_DIR, tmpDir, '应使用测试指定的归档目录')
})

test('归档：超期记录按月导出 gzip 并从主集合移除，保留期内不动', () => {
  auditLogs.splice(0, auditLogs.length,
    mk('2026-01-15 10:00:00', 'old.a'),
    mk('2026-01-20 11:00:00', 'old.b'),
    mk('2026-02-03 09:00:00', 'old.c'),
    mk('2026-07-01 00:00:00', 'boundary.keep'),   // 正好在起点 → 保留
    mk('2026-09-23 12:00:00', 'recent.keep')
  )
  const r = archiveOldAuditLogs({ now: NOW })
  assert.equal(r.archived, 3, '只归档超期的 3 条')
  assert.equal(r.files.length, 2, '跨两个月 → 两个文件')
  assert.deepEqual(r.files.map(f => f.month).sort(), ['2026-01', '2026-02'])

  // 主集合只留保留期内的（含边界那条）
  assert.deepEqual(auditLogs.map(l => l.action).sort(), ['boundary.keep', 'recent.keep'])

  // 归档文件可解压、内容与条数正确
  const jan = r.files.find(f => f.month === '2026-01')
  const lines = zlib.gunzipSync(fs.readFileSync(jan.file)).toString('utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).action, 'old.a')
  assert.equal(JSON.parse(lines[1]).actorName, '某人', '归档保留完整字段（含操作人）')
})

test('归档：没有超期记录时什么都不做（幂等）', () => {
  const filesBefore = fs.readdirSync(tmpDir).length
  const r = archiveOldAuditLogs({ now: NOW })
  assert.equal(r.archived, 0)
  assert.equal(r.files.length, 0)
  assert.equal(fs.readdirSync(tmpDir).length, filesBefore, '不应产生新文件')
  assert.deepEqual(auditLogs.map(l => l.action).sort(), ['boundary.keep', 'recent.keep'])
})

test('归档：同月重复归档合并进同一个文件，不会覆盖丢失', () => {
  auditLogs.push(mk('2026-03-05 08:00:00', 'march.old'))
  const r1 = archiveOldAuditLogs({ now: NOW })
  assert.equal(r1.archived, 1)
  const file = r1.files[0].file
  assert.match(path.basename(file), /^audit-2026-03\.jsonl\.gz$/, '按月命名，文件名稳定')

  // 同月再来一条：应合并进同一文件（先解压再追加），而不是新建/覆盖
  auditLogs.push(mk('2026-03-06 08:00:00', 'march.old2'))
  const r2 = archiveOldAuditLogs({ now: NOW })
  assert.equal(r2.archived, 1)
  assert.equal(r2.files[0].file, file)
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').trim().split('\n')
  assert.equal(lines.length, 2, '两次归档的记录都在同一个文件里')
  assert.deepEqual(lines.map(l => JSON.parse(l).action), ['march.old', 'march.old2'])
})
