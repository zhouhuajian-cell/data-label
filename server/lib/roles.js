// 账号多角色模型
// 约定：user.roleType 为主角色（保留给既有域使用），user.roleTypes 为该账号持有的全部角色（含主角色）。
// 一个账号可持多个角色 → 在确认链上"环环相扣"：既持业务工程师又持财务的账号可依次推进两个节点。
import { ApiError } from './http.js'

// 平台全部合法角色号（与 src/utils/constants.js 的 ROLE_TYPE 一致）
export const ALL_ROLES = [1, 2, 3, 4, 6, 7, 13, 14, 15, 16, 17, 18,
  // 19 独立结算：与统一结算方无合同关系的供应商，其单据不经统结方（见 bill-flow.js）
  19]

// 取账号的全部角色；未配置 roleTypes 时退回主角色
// 主角色恒排在首位（roleTypes[0] === roleType），便于按主角色做兜底判断
export function roleTypesOf(user) {
  if (!user) return []
  const list = Array.isArray(user.roleTypes) ? user.roleTypes.filter(r => ALL_ROLES.includes(Number(r))) : []
  const merged = [...new Set(list.map(Number))]
  const primary = ALL_ROLES.includes(Number(user.roleType)) ? Number(user.roleType) : null
  if (primary === null) return merged
  return [primary, ...merged.filter(r => r !== primary)]
}

export function hasRole(user, role) {
  return roleTypesOf(user).includes(Number(role))
}

export function hasAnyRole(user, roles) {
  const owned = roleTypesOf(user)
  return roles.some(r => owned.includes(Number(r)))
}

// 校验并规范化传入的角色集合：去重、排序、必须非空
export function normalizeRoleTypes(roleTypes, fallbackRoleType) {
  const raw = Array.isArray(roleTypes) && roleTypes.length ? roleTypes : [fallbackRoleType]
  const invalid = raw.map(Number).filter(r => !ALL_ROLES.includes(r))
  if (invalid.length) {
    throw new ApiError(422, 'VALIDATION_ERROR', `角色不合法：${invalid.join(', ')}`)
  }
  const list = [...new Set(raw.map(Number))].sort((a, b) => a - b)
  if (!list.length) throw new ApiError(422, 'VALIDATION_ERROR', '请至少分配一个角色')
  return list
}

// 供 JWT / 登录响应使用的精简角色信息
export function tokenRoles(user) {
  const roles = roleTypesOf(user)
  return { roleType: roles[0], roleTypes: roles }
}
