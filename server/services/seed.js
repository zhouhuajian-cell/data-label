import { tasks, taskItems, taskLogs } from '../repositories/data.js'

// 依据种子伪随机生成一张“模拟街景”SVG 样本图（data URL），供标注工作台演示
function makeSampleImage(seed, label) {
  let s = seed
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
  const palette = ['#8ab6f9', '#a5d6a7', '#ffcc80', '#ef9a9a', '#ce93d8', '#80deea', '#fff59d']
  let shapes = ''
  // 模拟天空与路面
  shapes += '<rect x="0" y="0" width="640" height="210" fill="#3d5266"/>'
  shapes += '<rect x="0" y="210" width="640" height="150" fill="#4a4a52"/>'
  shapes += '<line x1="0" y1="285" x2="640" y2="285" stroke="#e8c33a" stroke-width="4" stroke-dasharray="24 18"/>'
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(rnd() * 560)
    const y = 60 + Math.floor(rnd() * 240)
    const w = 50 + Math.floor(rnd() * 150)
    const h = 35 + Math.floor(rnd() * 100)
    shapes += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${palette[i % palette.length]}" opacity="0.85"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">${shapes}<text x="14" y="344" fill="#ffffff99" font-size="14" font-family="monospace">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

// 依据种子生成一组预标注框（模拟算法预标注 / 已有标注）
function makeBoxes(seed, count) {
  let s = seed * 7 + 13
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
  const labels = ['车辆', '行人', '骑行者', '交通标志']
  const boxes = []
  for (let i = 0; i < count; i++) {
    boxes.push({
      x: Math.round(rnd() * 480),
      y: Math.round(60 + rnd() * 220),
      w: Math.round(60 + rnd() * 120),
      h: Math.round(40 + rnd() * 80),
      label: labels[Math.floor(rnd() * labels.length)]
    })
  }
  return boxes
}

function makeItem(id, taskId, name, status, extra = {}) {
  return {
    id, taskId, itemName: name, dataType: '图像',
    status,
    failReason: '', screenshot: null, annotator: extra.annotator || '',
    image: makeSampleImage(id, name),
    annotation: { boxes: extra.boxes || [] },
    claimedBy: extra.claimedBy || null,
    workSeconds: extra.workSeconds || 0,
    isRework: !!extra.isRework,
    errorTypes: extra.errorTypes || [],
    rejectNote: extra.rejectNote || '',
    submitCount: extra.submitCount || 0,
    reworkCount: extra.reworkCount || 0,
    clientReviewed: !!extra.clientReviewed,
    firstPass: extra.firstPass === undefined ? null : extra.firstPass,
    history: extra.history || []
  }
}

export function seedDemoData() {
  // 演示任务：供应商A 的 2D 拉框任务（用于标注/质检工作台完整闭环演示）
  const demoTask = {
    id: 101, taskName: 'A08-街景2D拉框(工作台演示)', nanoId: 'ND101', annotateType: '2D拉框',
    state: 'ANNOTATING', deadline: '2026-07-31 18:00',
    sampleCount: 12, unitPrice: 0.5, totalPrice: 6,
    supplierId: 101, supplierName: '供应商A', currentRework: 1,
    qaStandard: '<p>1. 框体需完整贴合目标外边缘，误差≤2px。</p><p>2. 车辆/行人/骑行者不可漏标。</p><p>3. 标签选择必须与目标类别一致。</p>',
    ownerId: 1, projectId: 2,
    submitTime: null, acceptTime: null, rejectCount: 0,
    labels: ['车辆', '行人', '骑行者', '交通标志']
  }
  const demoTaskB = {
    id: 102, taskName: 'B01-路口目标检测框', nanoId: 'ND102', annotateType: '2D拉框',
    state: 'ANNOTATING', deadline: '2026-08-05 18:00',
    sampleCount: 3, unitPrice: 0.4, totalPrice: 1.2,
    supplierId: 102, supplierName: '供应商B', currentRework: 0,
    qaStandard: '<p>按路口目标检测规范执行。</p>',
    ownerId: 1, projectId: 2,
    submitTime: null, acceptTime: null, rejectCount: 0,
    labels: ['车辆', '行人']
  }
  tasks.push(demoTask, demoTaskB)
  taskLogs.push(
    { taskId: 101, time: '2026-07-20 10:00', content: '甲方创建演示任务并派单给供应商A', type: 'primary' },
    { taskId: 102, time: '2026-07-20 10:05', content: '甲方创建演示任务并派单给供应商B', type: 'primary' }
  )

  // 任务 101 的 12 条明细：覆盖完整状态机（pending/annotating/annotated/vendor_passed/accepted/rework）
  const items = [
    makeItem(1001, 101, '街景-0001', 'pending', { boxes: makeBoxes(1001, 2) }),
    makeItem(1002, 101, '街景-0002', 'pending', { boxes: makeBoxes(1002, 2) }),
    makeItem(1003, 101, '街景-0003', 'pending'),
    makeItem(1004, 101, '街景-0004', 'pending'),
    makeItem(1005, 101, '街景-0005', 'annotating', { annotator: '标注员A1', claimedBy: 5, boxes: makeBoxes(1005, 2), workSeconds: 1820 }),
    makeItem(1006, 101, '街景-0006', 'annotated', { annotator: '标注员A1', claimedBy: 5, boxes: makeBoxes(1006, 3), submitCount: 1, workSeconds: 950 }),
    makeItem(1007, 101, '街景-0007', 'annotated', { annotator: '标注员A2', claimedBy: 8, boxes: makeBoxes(1007, 2), submitCount: 1, workSeconds: 1240 }),
    makeItem(1008, 101, '街景-0008', 'vendor_passed', { annotator: '标注员A2', claimedBy: 8, boxes: makeBoxes(1008, 3), submitCount: 1, workSeconds: 2380 }),
    makeItem(1009, 101, '街景-0009', 'vendor_passed', { annotator: '标注员A1', claimedBy: 5, boxes: makeBoxes(1009, 1), submitCount: 1, workSeconds: 760 }),
    makeItem(1010, 101, '街景-0010', 'accepted', { annotator: '标注员A1', claimedBy: 5, boxes: makeBoxes(1010, 3), submitCount: 1, workSeconds: 3150, clientReviewed: true, firstPass: true }),
    makeItem(1011, 101, '街景-0011', 'accepted', { annotator: '标注员A2', claimedBy: 8, boxes: makeBoxes(1011, 2), submitCount: 1, workSeconds: 1980, clientReviewed: true, firstPass: true }),
    makeItem(1012, 101, '街景-0012', 'rework', {
      annotator: '标注员A1', claimedBy: 5, boxes: makeBoxes(1012, 2), submitCount: 1, workSeconds: 2600,
      isRework: true, errorTypes: ['bbox_inaccurate', 'missing_label'], rejectNote: '右下角车辆漏标，行人框偏大', reworkCount: 1, clientReviewed: true, firstPass: false,
      history: [{ time: '2026-07-21 15:20', actor: '甲方质检员', action: 'client_reject', note: '右下角车辆漏标，行人框偏大', errorTypes: ['bbox_inaccurate', 'missing_label'] }]
    })
  ]
  // 任务 102 的 5 条明细（供应商B，正向结算演示：FFR=100% -> 系数1.2奖励）
  items.push(
    makeItem(1101, 102, '路口-0001', 'pending'),
    makeItem(1102, 102, '路口-0002', 'annotated', { annotator: '标注员B1', claimedBy: 9, boxes: makeBoxes(1102, 2), submitCount: 1, workSeconds: 1100 }),
    makeItem(1103, 102, '路口-0003', 'accepted', { annotator: '标注员B1', claimedBy: 9, boxes: makeBoxes(1103, 3), submitCount: 1, workSeconds: 2700, clientReviewed: true, firstPass: true }),
    makeItem(1104, 102, '路口-0004', 'accepted', { annotator: '标注员B1', claimedBy: 9, boxes: makeBoxes(1104, 2), submitCount: 1, workSeconds: 1900, clientReviewed: true, firstPass: true }),
    makeItem(1105, 102, '路口-0005', 'accepted', { annotator: '标注员B1', claimedBy: 9, boxes: makeBoxes(1105, 3), submitCount: 1, workSeconds: 3100, clientReviewed: true, firstPass: true })
  )
  taskItems.push(...items)
  console.log('已注入演示种子数据：任务 101/102，明细 ' + items.length + ' 条')
}
