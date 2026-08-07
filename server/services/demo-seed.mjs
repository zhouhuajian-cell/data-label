// 演示种子：预置一条覆盖全数据链状态的任务（仅当不存在时注入）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeImage } from '../lib/images.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbFile = path.resolve(__dirname, '../data/db.json')


function makeBoxes(seed, count) {
  let s = seed * 7 + 13
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
  const labels = ['车辆', '行人', '骑行者', '交通标志']
  const boxes = []
  for (let i = 0; i < count; i++) {
    boxes.push({
      x: Math.round(rnd() * 480), y: Math.round(60 + rnd() * 220),
      w: Math.round(60 + rnd() * 120), h: Math.round(40 + rnd() * 80),
      label: labels[Math.floor(rnd() * labels.length)]
    })
  }
  return boxes
}

function makeItem(id, taskId, name, status, extra = {}) {
  return {
    id, taskId, itemName: name, dataType: '图像', status,
    failReason: '', screenshot: null, annotator: extra.annotator || '',
    image: makeImage(id, name), annotation: { boxes: extra.boxes || [] },
    claimedBy: extra.claimedBy || null, workSeconds: extra.workSeconds || 0,
    isRework: !!extra.isRework, errorTypes: extra.errorTypes || [],
    rejectNote: extra.rejectNote || '', submitCount: extra.submitCount || 0,
    reworkCount: extra.reworkCount || 0, clientReviewed: !!extra.clientReviewed,
    firstPass: extra.firstPass === undefined ? null : extra.firstPass,
    history: extra.history || [], tags: extra.tags || []
  }
}

function seed() {
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
  // 已有演示任务则跳过
  if (db.tasks.some(t => t.demoSeed)) { console.log('演示数据已存在，跳过'); return }

  const demoProject = {
    id: 100, name: '演示项目-全链路测试', clientName: '泰兴甲方',
    annotateType: '2D拉框', sampleCount: 18, deadline: '2026-08-31',
    status: 'active', description: '用于测试完整数据链：标注→内审→提交→验收→结算',
    datasetId: null, createdAt: '2026-08-04 10:00', updatedAt: '2026-08-04 10:00'
  }
  db.projects.push(demoProject)

  const baseTaskId = Math.max(...db.tasks.map(t => t.id), 0)
  const baseItemId = Math.max(...db.taskItems.map(i => i.id), 0)

  const tasks = [
    { name: 'T1-待指派(可派发)', state: 'UNASSIGNED', supId: null, supName: '', itemStatus: 'pending' },
    { name: 'T2-标注中(anno_a1作业)', state: 'ANNOTATING', supId: 101, supName: '供应商A', itemStatus: 'pending' },
    { name: 'T3-供应商质检(supp_a领取)', state: 'VENDOR_QA', supId: 101, supName: '供应商A', itemStatus: 'annotated' },
    { name: 'T4-甲方质检(admin验收)', state: 'CLIENT_QA', supId: 101, supName: '供应商A', itemStatus: 'vendor_passed' }
  ]

  let taskIdx = 0, itemIdx = 0
  tasks.forEach(t => {
    taskIdx++
    const id = baseTaskId + taskIdx
    db.tasks.push({
      id, taskName: t.name, nanoId: 'ND' + String(taskIdx).padStart(3, '0'),
      annotateType: '2D拉框', state: t.state, deadline: '2026-08-31 18:00',
      sampleCount: 4, unitPrice: 0.5, totalPrice: 2,
      supplierId: t.supId, supplierName: t.supName, currentRework: 0,
      qaStandard: '<p>框体需完整贴合目标外边缘，车辆/行人/骑行者不可漏标。</p>',
      ownerId: 1, projectId: 100, qaSamplingRate: 1,
      submitTime: t.state === 'CLIENT_QA' ? '2026-08-03 18:00' : null,
      acceptTime: null, rejectCount: 0, dataPackage: null, demoSeed: true,
      qaClaimedBy: null, qaClaimedByName: '', qaClaimedAt: null
    })
    for (let n = 1; n <= 4; n++) {
      itemIdx++
      const status = t.itemStatus
      db.taskItems.push(makeItem(baseItemId + itemIdx, id, `演示_${t.name.slice(0, 2)}_${String(n).padStart(3, '0')}.jpg`, status, {
        boxes: status === 'pending' ? [] : makeBoxes(baseItemId + itemIdx, 2),
        annotator: t.state === 'ANNOTATING' ? '标注员A1' : (status === 'pending' ? '' : '标注员A1'),
        claimedBy: t.state === 'ANNOTATING' ? 5 : null,
        clientReviewed: status === 'vendor_passed' || status === 'accepted',
        firstPass: status === 'accepted' ? true : null
      }))
    }
    db.taskLogs.push({ taskId: id, time: '2026-08-04 10:00', content: '演示任务已创建', type: 'primary' })
  })

  fs.writeFileSync(dbFile, JSON.stringify(db))
  console.log('演示数据注入完成：4 个任务 × 4 明细 = 16 条')
}

seed()
