// 财务域持久化：结算单与明细使用独立关系表（不再走"整集合 JSON 覆盖写"）
//
// 为什么单独做：
//   app_state 的 JSON 集合是"整集合重写"，写放大 = O(全库)，且单行受 max_allowed_packet(64MB) 限制。
//   结算单是长期增长的数据（3 年量级），必须做到行级写入 + 明细按需读取：
//     - bills      → 启动时一次性载入内存（只读查询沿用现有内存过滤），变更按行 upsert
//     - bill_items → 不进内存，按 billId 按需查询；明细是体量最大的一张表
//   未配置 MySQL（本地开发回退 db.json）时，内置一份等价的内存实现，接口保持一致。
import mysql from 'mysql2/promise'
import { config } from '../config.js'
import { MONEY_DECIMALS } from '../lib/money.js'

const BILLS = 'bills_finance'
const ITEMS = 'bill_items_finance'

let pool = null
let ready = null
// 未配置 MySQL 时的内存回退
const mem = { bills: [], items: [] }

export function isSqlEnabled() {
  return config.db.enabled
}

function getPool() {
  if (!config.db.enabled) return null
  if (pool) return pool
  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true,
    // 支持用 JSON 存确认链等小结构，同时保证金额字段的精度
    dateStrings: true
  })
  return pool
}

export async function initFinanceDb() {
  if (ready) return ready
  const p = getPool()
  if (!p) { ready = Promise.resolve(false); return ready }
  ready = (async () => {
    await p.query(`CREATE TABLE IF NOT EXISTS ${BILLS} (
      id INT PRIMARY KEY,
      bill_no VARCHAR(32) NOT NULL,
      project_id INT NULL,
      project_name VARCHAR(191) NULL,
      supplier_id INT NULL,
      supplier_name VARCHAR(128) NULL,
      batch_name VARCHAR(191) NULL,
      period VARCHAR(16) NULL,
      status VARCHAR(32) NOT NULL,
      current_stage INT NOT NULL DEFAULT 0,
      rejected TINYINT NOT NULL DEFAULT 0,
      reject_reason VARCHAR(512) NULL,
      item_count INT NOT NULL DEFAULT 0,
      total_quantity DECIMAL(28,10) NOT NULL DEFAULT 0,
      total_amount DECIMAL(28,10) NOT NULL DEFAULT 0,
      resubmit_count INT NOT NULL DEFAULT 0,
      formula VARCHAR(191) NULL,
      coefficient DECIMAL(28,10) NOT NULL DEFAULT 1,
      cost_centers JSON NULL,
      attachments JSON NULL,
      assignee_id INT NULL,
      assignee_name VARCHAR(64) NULL,
      assigned_by VARCHAR(64) NULL,
      assigned_at DATETIME NULL,
      source_file_name VARCHAR(255) NULL,
      import_mode VARCHAR(16) NULL,
      remark VARCHAR(512) NULL,
      finance JSON NULL,
      confirms JSON NULL,
      rejections JSON NULL,
      created_by INT NULL,
      created_by_name VARCHAR(64) NULL,
      created_at DATETIME NULL,
      updated_at DATETIME NULL,
      approved_at DATETIME NULL,
      UNIQUE KEY uk_bill_no (bill_no),
      KEY idx_status (status),
      KEY idx_supplier (supplier_id),
      KEY idx_project (project_id),
      KEY idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await p.query(`CREATE TABLE IF NOT EXISTS ${ITEMS} (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bill_id INT NOT NULL,
      seq INT NOT NULL DEFAULT 0,
      task_name VARCHAR(191) NULL,
      data_type VARCHAR(64) NULL,
      unit VARCHAR(16) NULL,
      accept_date VARCHAR(32) NULL,
      quantity DECIMAL(28,10) NOT NULL DEFAULT 0,
      unit_price DECIMAL(28,10) NOT NULL DEFAULT 0,
      amount DECIMAL(28,10) NOT NULL DEFAULT 0,
      data_path VARCHAR(512) NULL,
      remark VARCHAR(512) NULL,
      KEY idx_bill_seq (bill_id, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await ensureColumns(p)
    await ensureColumnTypes(p)
    return true
  })()
  return ready
}

// 为已存在的表补齐后加的列（CREATE TABLE IF NOT EXISTS 不会加列）
async function ensureColumns(p) {
  const wanted = [
    [BILLS, 'formula', "VARCHAR(191) NULL"],
    [BILLS, 'coefficient', "DECIMAL(12,4) NOT NULL DEFAULT 1"],
    [BILLS, 'cost_centers', "JSON NULL"],
    [BILLS, 'attachments', "JSON NULL"],
    [BILLS, 'assignee_id', "INT NULL"],
    [BILLS, 'assignee_name', "VARCHAR(64) NULL"],
    [BILLS, 'assigned_by', "VARCHAR(64) NULL"],
    [BILLS, 'assigned_at', "DATETIME NULL"],
    [BILLS, 'comparison', "JSON NULL"],
    [BILLS, 'urges', "JSON NULL"],
    [BILLS, 'supplier_submits', "JSON NULL"],
    [ITEMS, 'unit', "VARCHAR(16) NULL"]
  ]
  for (const [table, col, def] of wanted) {
    const [rows] = await p.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, col]
    )
    if (!Number(rows[0].c)) {
      await p.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
      console.log(`财务表已补充字段：${table}.${col}`)
    }
  }
}

// 金额/数量列升级到 10 位小数（CREATE TABLE IF NOT EXISTS 不会改类型，必须 MODIFY）
const MONEY_COLUMNS = [
  [BILLS, 'total_quantity', '0'],
  [BILLS, 'total_amount', '0'],
  [BILLS, 'coefficient', '1'],
  [ITEMS, 'quantity', '0'],
  [ITEMS, 'unit_price', '0'],
  [ITEMS, 'amount', '0']
]

async function ensureColumnTypes (p) {
  const [rows] = await p.query(
    `SELECT table_name t, column_name c, numeric_scale s FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name IN (?, ?)`, [BILLS, ITEMS])
  const scaleOf = {}
  rows.forEach(r => { scaleOf[`${r.t}.${r.c}`] = Number(r.s) })
  for (const [table, col, def] of MONEY_COLUMNS) {
    const scale = scaleOf[`${table}.${col}`]
    if (scale === undefined || scale >= MONEY_DECIMALS) continue
    await p.query(`ALTER TABLE ${table} MODIFY COLUMN ${col} DECIMAL(28,10) NOT NULL DEFAULT ${def}`)
    console.log(`财务表已提升金额精度：${table}.${col} → DECIMAL(28,10)`)
  }
}

const num = (v) => (v === null || v === undefined ? 0 : Number(v))
const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v))
const parseJson = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

function rowToBill(r) {
  return {
    id: Number(r.id), billNo: r.bill_no, batchName: r.batch_name, period: r.period || '',
    projectId: r.project_id === null ? null : Number(r.project_id), projectName: r.project_name || '',
    supplierId: r.supplier_id === null ? null : Number(r.supplier_id), supplierName: r.supplier_name || '',
    sourceFileName: r.source_file_name || '', importMode: r.import_mode || 'manual', remark: r.remark || '',
    currentStage: Number(r.current_stage), rejected: !!r.rejected, status: r.status,
    rejectReason: r.reject_reason || '', resubmitCount: Number(r.resubmit_count),
    confirms: parseJson(r.confirms) || [], rejections: parseJson(r.rejections) || [],
    finance: parseJson(r.finance),
    formula: r.formula === undefined ? null : r.formula,
    costCenters: parseJson(r.cost_centers) || [],
    attachments: parseJson(r.attachments) || [],
    assigneeId: r.assignee_id === null || r.assignee_id === undefined ? null : Number(r.assignee_id),
    assigneeName: r.assignee_name || '',
    assignedBy: r.assigned_by || '',
    assignedAt: r.assigned_at || null,
    coefficient: r.coefficient === undefined || r.coefficient === null ? 1 : Number(r.coefficient),
    itemCount: Number(r.item_count), totalQuantity: num(r.total_quantity), totalAmount: num(r.total_amount),
    createdBy: r.created_by === null ? null : Number(r.created_by), createdByName: r.created_by_name || '',
    createdAt: r.created_at || '', updatedAt: r.updated_at || '', approvedAt: r.approved_at || null,
    comparison: parseJson(r.comparison),
    urges: parseJson(r.urges) || [],
    supplierSubmits: parseJson(r.supplier_submits) || []
  }
}

function rowToItem(r) {
  return {
    id: Number(r.id), billId: Number(r.bill_id), seq: Number(r.seq),
    taskName: r.task_name || '', dataType: r.data_type || '', unit: r.unit || '', acceptDate: r.accept_date || '',
    quantity: num(r.quantity), unitPrice: num(r.unit_price), amount: num(r.amount),
    dataPath: r.data_path || '', remark: r.remark || ''
  }
}

// 启动载入全部结算单（只读逻辑沿用内存数组；明细不载入）
export async function loadBills() {
  const p = getPool()
  if (!p) return mem.bills
  await initFinanceDb()
  const [rows] = await p.query(`SELECT * FROM ${BILLS}`)
  return rows.map(rowToBill)
}

function billParams(b) {
  return [
    b.id, b.billNo, b.projectId ?? null, b.projectName ?? null, b.supplierId ?? null, b.supplierName ?? null,
    b.batchName ?? null, b.period ?? null, b.status, b.currentStage ?? 0, b.rejected ? 1 : 0, b.rejectReason ?? null,
    b.itemCount ?? 0, b.totalQuantity ?? 0, b.totalAmount ?? 0, b.resubmitCount ?? 0,
    b.formula ?? null, b.coefficient ?? 1, json(b.costCenters || []), json(b.attachments || []),
    b.assigneeId ?? null, b.assigneeName ?? null, b.assignedBy ?? null, b.assignedAt ?? null,
    b.sourceFileName ?? null, b.importMode ?? null, b.remark ?? null,
    json(b.finance), json(b.confirms || []), json(b.rejections || []),
    b.createdBy ?? null, b.createdByName ?? null, b.createdAt ?? null, b.updatedAt ?? null, b.approvedAt ?? null,
    json(b.comparison),
    json(b.urges || []),
    json(b.supplierSubmits || [])
  ]
}

// 单行 upsert（写放大从"整个集合"降到"一条记录"）
export async function saveBill(bill) {
  const p = getPool()
  if (!p) {
    const i = mem.bills.findIndex(b => b.id === bill.id)
    if (i >= 0) mem.bills[i] = bill; else mem.bills.push(bill)
    return
  }
  await initFinanceDb()
  await p.query(
    `INSERT INTO ${BILLS} (id, bill_no, project_id, project_name, supplier_id, supplier_name, batch_name, period,
       status, current_stage, rejected, reject_reason, item_count, total_quantity, total_amount, resubmit_count,
       formula, coefficient, cost_centers, attachments,
       assignee_id, assignee_name, assigned_by, assigned_at,
       source_file_name, import_mode, remark, finance, confirms, rejections,
       created_by, created_by_name, created_at, updated_at, approved_at, comparison, urges, supplier_submits)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       project_id=VALUES(project_id), project_name=VALUES(project_name), supplier_id=VALUES(supplier_id),
       supplier_name=VALUES(supplier_name), batch_name=VALUES(batch_name), period=VALUES(period),
       status=VALUES(status), current_stage=VALUES(current_stage), rejected=VALUES(rejected),
       reject_reason=VALUES(reject_reason), item_count=VALUES(item_count), total_quantity=VALUES(total_quantity),
       total_amount=VALUES(total_amount), resubmit_count=VALUES(resubmit_count),
       formula=VALUES(formula), coefficient=VALUES(coefficient), cost_centers=VALUES(cost_centers),
       attachments=VALUES(attachments), assignee_id=VALUES(assignee_id), assignee_name=VALUES(assignee_name),
       assigned_by=VALUES(assigned_by), assigned_at=VALUES(assigned_at),
       source_file_name=VALUES(source_file_name), import_mode=VALUES(import_mode), remark=VALUES(remark),
       finance=VALUES(finance), confirms=VALUES(confirms), rejections=VALUES(rejections),
       updated_at=VALUES(updated_at), approved_at=VALUES(approved_at), comparison=VALUES(comparison),
       urges=VALUES(urges), supplier_submits=VALUES(supplier_submits)`,
    billParams(bill)
  )
}

export async function deleteBillRow(billId) {
  const p = getPool()
  if (!p) {
    mem.bills = mem.bills.filter(b => b.id !== billId)
    mem.items = mem.items.filter(i => i.billId !== billId)
    return
  }
  await initFinanceDb()
  await p.query(`DELETE FROM ${BILLS} WHERE id = ?`, [billId])
  await p.query(`DELETE FROM ${ITEMS} WHERE bill_id = ?`, [billId])
}

// 明细：按单据按需读取（不进内存）
export async function loadItems(billId) {
  const p = getPool()
  if (!p) return mem.items.filter(i => i.billId === billId).sort((a, b) => a.seq - b.seq)
  await initFinanceDb()
  const [rows] = await p.query(`SELECT * FROM ${ITEMS} WHERE bill_id = ? ORDER BY seq ASC`, [billId])
  return rows.map(rowToItem)
}

export async function replaceItems(billId, details) {
  const p = getPool()
  if (!p) {
    mem.items = mem.items.filter(i => i.billId !== billId)
    details.forEach((d, i) => mem.items.push({ ...d, billId, seq: i + 1 }))
    return
  }
  await initFinanceDb()
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`DELETE FROM ${ITEMS} WHERE bill_id = ?`, [billId])
    if (details.length) {
      const values = details.map((d, i) => [billId, i + 1, d.taskName ?? null, d.dataType ?? null, d.unit ?? null, d.acceptDate ?? null,
        d.quantity ?? 0, d.unitPrice ?? 0, d.amount ?? 0, d.dataPath ?? null, d.remark ?? null])
      await conn.query(
        `INSERT INTO ${ITEMS} (bill_id, seq, task_name, data_type, unit, accept_date, quantity, unit_price, amount, data_path, remark) VALUES ?`,
        [values]
      )
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    throw e
  } finally {
    conn.release()
  }
}

// 导出用：一次取回多张单据的明细（按需、可分页）
export async function loadItemsForBills(billIds) {
  if (!billIds.length) return []
  const p = getPool()
  if (!p) return mem.items.filter(i => billIds.includes(i.billId)).sort((a, b) => b.billId - a.billId || a.seq - b.seq)
  await initFinanceDb()
  const [rows] = await p.query(`SELECT * FROM ${ITEMS} WHERE bill_id IN (?) ORDER BY bill_id DESC, seq ASC`, [billIds])
  return rows.map(rowToItem)
}

// 把 app_state 里的历史 JSON 集合迁入关系表（幂等）
export async function migrateFromJsonCollections(jsonBills, jsonItems) {
  const p = getPool()
  if (!p) return { migrated: 0 }
  await initFinanceDb()
  const [[{ c }]] = await p.query(`SELECT COUNT(*) c FROM ${BILLS}`)
  if (Number(c) > 0) return { migrated: 0, skipped: true }
  for (const b of jsonBills || []) {
    await saveBill(b)
  }
  const byBill = new Map()
  for (const it of jsonItems || []) {
    if (!byBill.has(it.billId)) byBill.set(it.billId, [])
    byBill.get(it.billId).push(it)
  }
  for (const [billId, list] of byBill) {
    await replaceItems(billId, list.sort((a, b2) => a.seq - b2.seq))
  }
  return { migrated: (jsonBills || []).length, items: (jsonItems || []).length }
}
