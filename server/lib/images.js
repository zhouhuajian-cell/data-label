// 伪随机占位图生成（SVG data URL），供导入/种子数据生成缩略图使用
export function makeImage(seed, label) {
  let s = seed
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280
  const palette = ['#6baed6', '#74c476', '#fdae6b', '#fb6a4a', '#9e9ac8', '#78c679', '#fd8d3c']
  let shapes = '<rect width="640" height="200" fill="#87ceeb"/><rect y="200" width="640" height="160" fill="#666"/>'
  shapes += '<line x1="0" y1="280" x2="640" y2="280" stroke="#ffcc00" stroke-width="3" stroke-dasharray="20 16"/>'
  for (let i = 0; i < 6; i++) {
    const x = 20 + Math.floor(rnd() * 520)
    const y = 50 + Math.floor(rnd() * 250)
    const w = 40 + Math.floor(rnd() * 120)
    const h = 30 + Math.floor(rnd() * 80)
    shapes += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${palette[i % palette.length]}" opacity="0.85"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">${shapes}<text x="12" y="348" fill="#fff" font-size="12" font-family="monospace" opacity="0.6">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}
