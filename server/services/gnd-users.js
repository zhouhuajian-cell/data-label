// GND 用户与供应商管理：用户列表 / 审批 / 禁用 / 供应商名册
import { ApiError } from '../lib/http.js'
import { nowText } from '../lib/time.js'
import { gndUsers, gndSuppliers } from '../repositories/data.js'
import { nextId, writeAudit } from './gnd-common.js'

const TAIXING_ADMIN = 8
const ROLES = [8, 9, 10, 11, 12]

function requireAdmin(user) {
  if (user.roleType !== TAIXING_ADMIN) throw new ApiError(403, 'FORBIDDEN', '仅泰兴管理员可操作')
}

function findUser(id) {
  const u = gndUsers.find(x => x.id === id)
  if (!u) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在')
  return u
}

function publicUser(u) {
  return { id: u.id, username: u.username, feishuOpenId: u.feishuOpenId || '', name: u.name, email: u.email || '', roleType: u.roleType, supplierId: u.supplierId, status: u.status, createdAt: u.createdAt }
}

// ===== 用户列表 / 审批队列 =====
export function listUsers(user, q) {
  requireAdmin(user)
  let list = gndUsers.slice()
  const status = String(q.get('status') || '').trim()
  const keyword = String(q.get('keyword') || '').trim()
  if (status) list = list.filter(u => u.status === status)
  if (keyword) list = list.filter(u => (u.name || '').includes(keyword) || (u.username || '').includes(keyword))
  list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  const page = Math.max(Number(q.get('page') || 1), 1)
  const pageSize = Math.min(Math.max(Number(q.get('page_size') || 20), 1), 100)
  return { items: list.slice((page - 1) * pageSize, page * pageSize).map(publicUser), total: list.length, page, pageSize }
}

// ===== 审批通过：分配角色（8-12）；供应商角色必须指定 supplierId =====
export function approveUser(user, id, body) {
  requireAdmin(user)
  const target = findUser(id)
  if (target.status !== 'PENDING') throw new ApiError(409, 'TASK_STATE_CONFLICT', '仅待审批账号可审批')
  const roleType = Number(body.roleType)
  if (!ROLES.includes(roleType)) throw new ApiError(422, 'VALIDATION_ERROR', 'roleType 必须为 8-12')
  let supplierId = null
  if (roleType === 12) {
    supplierId = Number(body.supplierId)
    if (!supplierId || !gndSuppliers.some(s => s.id === supplierId)) {
      throw new ApiError(422, 'VALIDATION_ERROR', '供应商角色必须指定有效的 supplierId')
    }
  }
  target.roleType = roleType
  target.supplierId = supplierId
  target.status = 'ACTIVE'
  target.approvedBy = user.id
  target.approvedAt = nowText()
  target.updatedAt = nowText()
  writeAudit(user, 'gnd.user.approve', null, { targetUserId: id, roleType, supplierId })
  return publicUser(target)
}

// ===== 拒绝注册 =====
export function rejectUser(user, id) {
  requireAdmin(user)
  const target = findUser(id)
  if (target.status !== 'PENDING') throw new ApiError(409, 'TASK_STATE_CONFLICT', '仅待审批账号可拒绝')
  target.status = 'REJECTED'
  target.updatedAt = nowText()
  writeAudit(user, 'gnd.user.reject', null, { targetUserId: id })
  return { rejected: true }
}

// ===== 禁用 / 恢复 =====
export function disableUser(user, id, body) {
  requireAdmin(user)
  if (id === user.id) throw new ApiError(422, 'VALIDATION_ERROR', '不能操作自身账号')
  const target = findUser(id)
  if (target.username === 'gnd_admin') throw new ApiError(422, 'VALIDATION_ERROR', '种子管理员账号不可禁用')
  const status = String(body.status || '').toUpperCase()
  if (!['ACTIVE', 'DISABLED'].includes(status)) throw new ApiError(422, 'VALIDATION_ERROR', 'status 必须为 ACTIVE 或 DISABLED')
  target.status = status
  target.updatedAt = nowText()
  writeAudit(user, 'gnd.user.disable', null, { targetUserId: id, status })
  return publicUser(target)
}

// ===== 供应商名册 =====
export function listSuppliers(user, q) {
  let list = gndSuppliers.slice()
  const keyword = String(q.get('keyword') || '').trim()
  const status = String(q.get('status') || '').trim()
  if (keyword) list = list.filter(s => s.name.includes(keyword) || (s.code || '').includes(keyword))
  if (status) list = list.filter(s => s.status === status)
  return list
}

export function createSupplier(user, body) {
  requireAdmin(user)
  const name = String(body.name || '').trim()
  const code = String(body.code || '').trim()
  if (!name) throw new ApiError(422, 'VALIDATION_ERROR', '供应商名称必填')
  if (gndSuppliers.some(s => s.name === name)) throw new ApiError(409, 'SUPPLIER_DUPLICATE', '供应商名称已存在')
  if (code && gndSuppliers.some(s => s.code === code)) throw new ApiError(409, 'SUPPLIER_DUPLICATE', '供应商编码已存在')
  const supplier = {
    id: nextId(gndSuppliers),
    name,
    code,
    contact: String(body.contact || '').trim(),
    status: 'ACTIVE',
    createdAt: nowText()
  }
  gndSuppliers.push(supplier)
  writeAudit(user, 'gnd.supplier.create', null, { name, code })
  return supplier
}
