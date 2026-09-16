<template>
  <div class="settle-page">
    <!-- 财务口径的统计（每张单都进这里核算） -->
    <div class="stat-row" :style="{ gridTemplateColumns: `repeat(${statColumns}, 1fr)` }">
      <el-card v-for="c in statCards" :key="c.key" class="stat-card" shadow="hover">
        <div class="stat-head">
          <span class="stat-num" :style="{ color: c.color }">{{ c.val }}</span>
          <span class="stat-unit">{{ c.unit }}</span>
        </div>
        <div class="stat-label">{{ c.label }}</div>
      </el-card>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>财务结算（逐单核算 → 财务确认）</span>
          <div class="head-actions">
            <el-select v-model="filters.projectId" placeholder="全部项目" clearable filterable class="fl-select" @change="reload">
              <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
            <el-select v-model="filters.supplierName" placeholder="全部供应商" clearable class="fl-select-sm" @change="reload">
              <el-option v-for="name in supplierOptions" :key="name" :label="name" :value="name" />
            </el-select>
            <el-input v-model="filters.keyword" placeholder="单号 / 项目 / 批次" clearable class="fl-input" @keyup.enter="reload" @clear="reload" />
            <el-button :icon="Search" @click="reload">查询</el-button>
            <el-button :icon="Download" :loading="exporting" @click="onExport">导出结算表</el-button>
          </div>
        </div>
      </template>

      <div class="chips">
        <span v-for="chip in chips" :key="chip.key" class="chip" :class="{ active: activeChip === chip.key }" @click="onChip(chip)">
          {{ chip.label }}<b v-if="chip.count !== null"> {{ chip.count }}</b>
        </span>
      </div>

      <el-table v-loading="loading" :data="list" border size="small">
        <el-table-column label="结算单号" prop="billNo" :width="w(146)" />
        <el-table-column label="项目" prop="projectName" min-width="130" show-overflow-tooltip />
        <el-table-column label="供应商" prop="supplierName" :width="w(100)" show-overflow-tooltip />
        <el-table-column label="基础金额" :width="w(104)" align="right">
          <template #default="s">¥{{ formatMoney(s.row.baseAmount) }}</template>
        </el-table-column>
        <el-table-column label="扣款" :width="w(92)" align="right">
          <template #default="s">
            <span :class="{ 'money-ded': s.row.finance?.deduction }">
              {{ s.row.finance ? formatMoney(s.row.finance.deduction) : '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="税率" :width="w(76)" align="right">
          <template #default="s">{{ s.row.finance ? s.row.finance.taxRate + '%' : '—' }}</template>
        </el-table-column>
        <el-table-column label="应付金额" :width="w(116)" align="right">
          <template #default="s">
            <span v-if="s.row.payableAmount !== null" class="money">¥{{ formatMoney(s.row.payableAmount) }}</span>
            <span v-else class="tip">待核算</span>
          </template>
        </el-table-column>
        <el-table-column label="核算人" :width="w(90)">
          <template #default="s">{{ s.row.finance?.calculatedByName || '—' }}</template>
        </el-table-column>
        <el-table-column label="统结对比" :width="w(126)">
          <template #default="s">
            <template v-if="s.row.comparison">
              <span :class="{ 'cmp-bad': s.row.comparison.exceeded }">{{ s.row.comparison.ratePercent }}%</span>
              <el-tag v-if="s.row.comparison.exceeded" type="danger" size="small">超限</el-tag>
            </template>
            <span v-else class="tip">—</span>
          </template>
        </el-table-column>
        <el-table-column label="当前环节" :width="w(130)">
          <template #default="s">
            <el-tag :type="getBillStatusType(s.row.status)" size="small">{{ getBillStatusText(s.row.status) }}</el-tag>
            <span v-if="s.row.currentHandler" class="tip"> · {{ s.row.currentHandler }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="w(168)" fixed="right">
          <template #default="s">
            <el-button v-if="s.row.status === 'PENDING_BIZ'" text type="primary" @click="openAssign(s.row)">
              {{ s.row.assigneeId ? '改派' : '指派工程师' }}
            </el-button>
            <el-button v-if="s.row.status === 'PENDING_FINANCE'" text type="primary" @click="openCalc(s.row)">
              {{ s.row.payableAmount === null ? '核算' : '重算' }}
            </el-button>
            <el-popconfirm
              v-if="s.row.status === 'PENDING_FINANCE' && s.row.payableAmount !== null"
              title="确认通过？将流转至「负责人确认」"
              @confirm="onConfirmRow(s.row)"
            >
              <template #reference><el-button text type="success">确认</el-button></template>
            </el-popconfirm>
            <!-- 加急催办：单据没走完、当前环节又不是财务时可用（10 分钟内同一单一次） -->
            <el-tooltip v-if="canUrgeRow(s.row)" :content="s.row.urgeCount ? `加急催办当前环节（已催办 ${s.row.urgeCount} 次）` : '加急催办当前环节的处理人'" placement="top">
              <el-button text type="warning" @click="onUrgeRow(s.row)">催办</el-button>
            </el-tooltip>
            <el-button text type="info" @click="openDetail(s.row.id)">明细</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" description="暂无待结算单据" :image-size="80" />

      <el-pagination
        v-if="total > filters.pageSize"
        class="pager"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="filters.pageSize"
        :current-page="filters.page"
        @current-change="(p) => { filters.page = p; loadList() }"
      />
    </el-card>

    <!-- 核算弹窗 -->
    <el-dialog v-model="calcVisible" title="财务核算" width="560px" :close-on-click-modal="false">
      <div v-if="calcBill" class="calc-wrap">
        <el-descriptions :column="2" border size="small" class="mb14">
          <el-descriptions-item label="结算单号">{{ calcBill.billNo }}</el-descriptions-item>
          <el-descriptions-item label="供应商">{{ calcBill.supplierName }}</el-descriptions-item>
          <el-descriptions-item label="项目">{{ calcBill.projectName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="批次">{{ calcBill.batchName }}</el-descriptions-item>
        </el-descriptions>

        <el-form label-width="90px" label-position="right" size="default">
          <el-form-item label="基础金额">
            <span class="calc-base">¥{{ formatMoney(calcBill.baseAmount) }}</span>
            <span class="tip">（数量 × 单价合计）</span>
          </el-form-item>
          <el-form-item label="扣款(元)">
            <el-input-number v-model="calcForm.deduction" :step="10" :controls="false" style="width:100%" placeholder="正数扣款，负数追加" />
          </el-form-item>
          <el-form-item label="税率(%)">
            <el-input-number v-model="calcForm.taxRate" :min="0" :max="100" :step="1" :controls="false" style="width:100%" />
          </el-form-item>
          <el-form-item label="核算备注">
            <el-input v-model="calcForm.note" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="如：扣违约金 100，依据合同第 3 条" />
          </el-form-item>
        </el-form>

        <div class="calc-result">
          <div class="cr-item"><span class="cr-label">扣款后金额</span><b>¥{{ formatMoney(calcResult.netAmount) }}</b></div>
          <div class="cr-item"><span class="cr-label">税额</span><b>¥{{ formatMoney(calcResult.taxAmount) }}</b></div>
          <div class="cr-item cr-main"><span class="cr-label">应付金额</span><b>¥{{ formatMoney(calcResult.payableAmount) }}</b></div>
        </div>
      </div>
      <template #footer>
        <el-button @click="calcVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSaveCalc">保存核算</el-button>
      </template>
    </el-dialog>

    <!-- 指派工程师 -->
    <el-dialog v-model="assignVisible" title="指派工程师确认数据" width="420px">
      <div class="assign-tip">
        单据：{{ assignBill?.billNo }}（{{ assignBill?.batchName }}）<br>
        供应商：{{ assignBill?.supplierName }} · 项目：{{ assignBill?.projectName || '-' }}
      </div>
      <el-select v-model="assignEngineerId" placeholder="选择该项目的数据确认工程师" style="width:100%">
        <el-option v-for="e in engineerOptions" :key="e.id" :label="e.userName" :value="e.id" />
      </el-select>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="assigning" @click="onAssign">指派并通知</el-button>
      </template>
    </el-dialog>

    <!-- 明细抽屉（与项目页/结算页共用） -->
    <BillDetailDrawer v-model="detailVisible" :bill-id="detailBillId" @changed="refreshAll" />
  </div>
</template>

<script setup>
// 财务结算：每一单验收数据都会流转到这里，由财务逐单核算（扣款/税率 → 应付金额）后确认
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { formatMoney, getBillStatusText, getBillStatusType, hasRole, ROLE_TYPE } from '@/utils/constants'
import { listBillsApi, getBillStatsApi, calculateBillApi, confirmBillApi, billExportPath, listEngineersApi, assignEngineerApi, urgeBillApi } from '@/api/finance'
import { listProjectOptionsApi } from '@/api/projects'
import { listSupplierNamesApi } from '@/api/finance'
import { useResponsive } from '@/composables/useResponsive'
import { useDownload } from '@/composables/useDownload'
import BillDetailDrawer from '@/components/finance/BillDetailDrawer.vue'

const userStore = useUserStore()
const { downloadFile } = useDownload()
const { statColumns, tableScale } = useResponsive()
const w = (px) => Math.round(px * tableScale.value)

const list = ref([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const saving = ref(false)
const stats = ref({})
// 默认展示「待我处理」（待指派 + 待核算），否则张海霞看不到待指派的新单
const activeChip = ref('todo')
const projectOptions = ref([])
const supplierOptions = ref([])
const detailVisible = ref(false)
const detailBillId = ref(null)

const filters = reactive({ page: 1, pageSize: 20, keyword: '', projectId: null, supplierName: '', status: 'PENDING_BIZ,PENDING_FINANCE' })

const statCards = computed(() => {
  const s = stats.value || {}
  return [
    { key: 'assign', val: s.byStatus?.PENDING_BIZ || 0, unit: '单', label: '待指派工程师', color: '#d68a1c' },
    { key: 'todo', val: s.byStatus?.PENDING_FINANCE || 0, unit: '单', label: '待财务核算/确认', color: '#e6a23c' },
    { key: 'approved', val: s.approvedCount || 0, unit: '单', label: '已通过', color: '#67c23a' },
    { key: 'payable', val: '¥' + formatMoney(s.pendingPayableAmount), unit: '', label: '在途应付金额', color: '#d64550' }
  ]
})

const chips = computed(() => {
  const s = stats.value || {}
  const assign = s.byStatus?.PENDING_BIZ || 0
  const finance = s.byStatus?.PENDING_FINANCE || 0
  return [
    { key: 'todo', label: '待我处理', count: assign + finance, status: 'PENDING_BIZ,PENDING_FINANCE' },
    { key: 'assign', label: '待指派工程师', count: assign, status: 'PENDING_BIZ' },
    { key: 'finance', label: '待财务确认', count: finance, status: 'PENDING_FINANCE' },
    { key: 'all', label: '全部单据', count: s.total || 0, status: 'all' },
    { key: 'approved', label: '已通过', count: s.approvedCount || 0, status: 'APPROVED' },
    { key: 'rejected', label: '已驳回', count: s.rejectedCount || 0, status: 'REJECTED' }
  ]
})

const calcVisible = ref(false)
const calcBill = ref(null)
const calcForm = reactive({ deduction: 0, taxRate: 0, note: '' })

// 与后端同一口径：扣款后金额 → 税额 → 应付金额
const calcResult = computed(() => {
  const base = calcBill.value?.baseAmount || 0
  const deduction = Number(calcForm.deduction) || 0
  const taxRate = Number(calcForm.taxRate) || 0
  const netAmount = Number((base - deduction).toFixed(10))
  const taxAmount = Number((netAmount * taxRate / 100).toFixed(10))
  return { netAmount, taxAmount, payableAmount: Number((netAmount + taxAmount).toFixed(10)) }
})

async function loadStats() {
  try {
    const { data } = await getBillStatsApi()
    stats.value = data || {}
    ;(data?.suppliers || []).forEach(r => {
      if (r.supplierName && !supplierOptions.value.includes(r.supplierName)) {
        supplierOptions.value.push(r.supplierName)
      }
    })
  } catch { /* 统计失败不阻塞列表 */ }
}

async function loadList() {
  loading.value = true
  try {
    const { data, meta } = await listBillsApi({
      page: filters.page, pageSize: filters.pageSize, keyword: filters.keyword,
      projectId: filters.projectId, supplierName: filters.supplierName, status: filters.status
    })
    list.value = data || []
    total.value = meta?.total || 0
  } catch { list.value = []; total.value = 0 } finally { loading.value = false }
}

function reload() { filters.page = 1; loadList() }

function onChip(chip) {
  activeChip.value = chip.key
  filters.status = chip.status
  reload()
}

function openCalc(row) {
  calcBill.value = row
  calcForm.deduction = row.finance?.deduction ?? 0
  calcForm.taxRate = row.finance?.taxRate ?? 0
  calcForm.note = row.finance?.note || ''
  calcVisible.value = true
}

async function onSaveCalc() {
  if (!calcBill.value) return
  saving.value = true
  try {
    await calculateBillApi(calcBill.value.id, {
      deduction: Number(calcForm.deduction) || 0,
      taxRate: Number(calcForm.taxRate) || 0,
      note: calcForm.note
    })
    ElMessage.success(`已核算，应付金额 ¥${formatMoney(calcResult.value.payableAmount)}`)
    calcVisible.value = false
    await refreshAll()
  } catch { /* 错误提示由 request 统一处理 */ } finally { saving.value = false }
}

// 核算完成后可在本页直接确认（流转到负责人）
// ===== 加急催办 =====
function canUrgeRow (row) {
  return row.status !== 'APPROVED' && row.status !== 'REJECTED' && !row.isMyTurn
}
async function onUrgeRow (row) {
  let note = ''
  try {
    const r = await ElMessageBox.prompt('可填写催办说明（选填，最多 100 字）', '加急催办', {
      confirmButtonText: '发送催办', cancelButtonText: '取消', inputValue: '',
      inputPlaceholder: '例如：本单今天必须确认完成',
      inputValidator: (v) => String(v || '').length <= 100 || '最多 100 字'
    })
    note = String(r.value || '').trim()
  } catch { return }
  try {
    await urgeBillApi(row.id, note)
    ElMessage.success('已发送加急催办')
    reload()
  } catch { /* 错误提示由 request 统一处理（含 10 分钟内重复催办） */ }
}

async function onConfirmRow(row) {
  try {
    await confirmBillApi(row.id, '财务核算完成')
    ElMessage.success('已确认，流转至「负责人确认」')
    await refreshAll()
  } catch { /* 错误提示由 request 统一处理 */ }
}

function openDetail(id) { detailBillId.value = id; detailVisible.value = true }

// 指派工程师（张海霞）：供应商提交后指定本项目的数据确认人
const assignVisible = ref(false)
const assignBill = ref(null)
const engineerOptions = ref([])
const assignEngineerId = ref(null)
const assigning = ref(false)

async function openAssign(row) {
  assignBill.value = row
  assignEngineerId.value = row.assigneeId || null
  assignVisible.value = true
  if (!engineerOptions.value.length) {
    try { const { data } = await listEngineersApi(); engineerOptions.value = data || [] } catch { /* 忽略 */ }
  }
}

async function onAssign() {
  if (!assignEngineerId.value) { ElMessage.warning('请选择工程师'); return }
  assigning.value = true
  try {
    await assignEngineerApi(assignBill.value.id, assignEngineerId.value)
    ElMessage.success('已指派，已通知该工程师')
    assignVisible.value = false
    await refreshAll()
  } catch { /* 错误提示由 request 统一处理 */ } finally { assigning.value = false }
}

async function refreshAll() { await Promise.all([loadList(), loadStats()]) }

async function onExport() {
  exporting.value = true
  try {
    const path = billExportPath({ keyword: filters.keyword, projectId: filters.projectId, supplierName: filters.supplierName, status: filters.status })
    await downloadFile(path, `财务结算表_${new Date().toISOString().slice(0, 10)}.csv`)
    ElMessage.success('导出成功')
  } catch (e) { ElMessage.error(e.message || '导出失败') } finally { exporting.value = false }
}

onMounted(async () => {
  await Promise.all([loadStats(), loadList()])
  try { const { data } = await listProjectOptionsApi(); projectOptions.value = data || [] } catch { /* 忽略 */ }
  try { if (hasRole(userStore.userInfo, ROLE_TYPE.CLIENT_PM)) { const { data } = await listSupplierNamesApi(); supplierOptions.value = data || [] } } catch { /* 忽略 */ }
})
</script>

<style scoped>
.settle-page { display: flex; flex-direction: column; gap: 14px; }
.stat-row { display: grid; gap: 12px; }
.stat-card { text-align: center; }
.stat-card :deep(.el-card__body) { padding: 12px 14px; }
.stat-head { display: flex; align-items: baseline; justify-content: center; gap: 3px; }
.stat-num { font-size: 24px; font-weight: 700; line-height: 1.15; }
.stat-unit { font-size: 12px; color: var(--text-3); }
.stat-label { color: var(--text-3); margin-top: 3px; font-size: 13px; }
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1 1 auto; justify-content: flex-end; }
.head-actions .fl-select { flex: 0 1 170px; min-width: 130px; }
.head-actions .fl-select-sm { flex: 0 1 140px; min-width: 112px; }
.head-actions .fl-input { flex: 0 1 170px; min-width: 130px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip {
  padding: 4px 14px; border-radius: 14px; background: var(--tag-bg, #f5f7fa);
  font-size: 12px; cursor: pointer; border: 1px solid transparent; user-select: none;
  transition: all 0.16s ease;
}
.chip:hover { border-color: var(--primary-border, #c6d4f7); }
.chip.active { background: var(--primary, #409eff); color: #fff; }
.money { color: #67c23a; font-weight: 700; }
.money-ded { color: #d64550; }
.tip { font-size: 12.5px; color: var(--text-3); }
.cmp-bad { color: var(--danger, #d64550); font-weight: 700; }
.assign-tip { font-size: 13px; color: var(--text-2); line-height: 1.8; margin-bottom: 12px; }
.pager { margin-top: 12px; justify-content: flex-end; }
.calc-wrap { max-height: 62vh; overflow-y: auto; }
.mb14 { margin-bottom: 14px; }
.calc-base { font-size: 18px; font-weight: 700; color: var(--text-1); margin-right: 8px; }
.calc-result {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  padding: 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border);
}
.cr-item { text-align: center; }
.cr-label { display: block; font-size: 12.5px; color: var(--text-3); margin-bottom: 4px; }
.cr-item b { font-size: 16px; color: var(--text-1); }
.cr-main b { color: #18a058; font-size: 20px; }
@media (max-width: 1180px) { .calc-result { grid-template-columns: 1fr; } }
</style>
