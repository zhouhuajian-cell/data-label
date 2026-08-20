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
  // 演示业务数据已移除：新环境从空库开始，由用户创建真实项目/任务/明细
}
