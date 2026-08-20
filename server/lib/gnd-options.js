// GND 枚举配置读取/维护（城市/车型/道路场景/数据类型）
import { ApiError } from './http.js'
import { gndOptions } from '../repositories/data.js'

export const GND_OPTION_CATEGORIES = ['CITY', 'VEHICLE_MODEL', 'DATA_TYPE', 'ROAD_SCENE']

/** 查询枚举（可过滤分类，enabled 优先排序） */
export function getOptions(category) {
  let items = gndOptions
  if (category) items = items.filter(o => o.category === category)
  return items
    .filter(o => o.enabled !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

/** 校验 code 是否存在于指定分类（enabled 才有效） */
export function isOptionValid(category, code) {
  return getOptions(category).some(o => o.code === code)
}

/** 整体替换一个分类的启用项（泰兴管理员维护） */
export function setOptions(category, items) {
  if (!GND_OPTION_CATEGORIES.includes(category)) {
    throw new ApiError(422, 'VALIDATION_ERROR', '非法枚举分类：' + category)
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'items 不能为空')
  }
  const codes = items.map(i => String(i.code || '').trim())
  if (codes.some(c => !c) || new Set(codes).size !== codes.length) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'items 内 code 必填且唯一')
  }
  const nextId = Math.max(0, ...gndOptions.map(o => o.id)) + 1
  const removed = gndOptions.filter(o => o.category === category)
  for (const r of removed) gndOptions.splice(gndOptions.indexOf(r), 1)
  items.forEach((item, idx) => {
    gndOptions.push({
      id: nextId + idx,
      category,
      code: String(item.code).trim(),
      label: String(item.label || item.code).trim(),
      sortOrder: Number(item.sortOrder) || idx + 1,
      enabled: item.enabled !== false
    })
  })
  return getOptions(category)
}
