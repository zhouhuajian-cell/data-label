<template>
  <div class="bills-page">
    <!-- 统计卡片（数量 + 金额，一眼看清结算全貌） -->
    <div class="stat-row" :style="{ gridTemplateColumns: `repeat(${statColumns}, 1fr)` }">
      <el-card v-for="c in statCards" :key="c.key" class="stat-card" shadow="hover" @click="onChip(c)">
        <div class="stat-head">
          <span class="stat-num" :style="{ color: c.color }">{{ c.val }}</span>
          <span class="stat-unit">单</span>
        </div>
        <div class="stat-label">{{ c.label }}</div>
        <div class="stat-money">{{ c.money }}</div>
      </el-card>
    </div>

    <!-- 各环节待办：钱卡在哪个节点，一眼看到 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>各环节待办</span>
          <span class="tip">点击节点可筛选该环节的待确认单据</span>
        </div>
      </template>
      <div class="node-row">
        <div
          v-for="n in nodeStats"
          :key="n.status"
          class="node-item"
          :class="{ active: filters.status === n.status, zero: !n.count }"
          @click="onNodeFilter(n)"
        >
          <div class="node-name">{{ n.label }}</div>
          <div class="node-count"><b>{{ n.count }}</b> 单</div>
          <div class="node-money">¥{{ formatMoney(n.amount) }}</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>验收结算确认单</span>
          <div class="head-actions">
            <el-select v-model="filters.projectId" placeholder="全部项目" clearable filterable class="fl-select" @change="reload">
              <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
            <el-select v-if="!isSupplierOnly" v-model="filters.supplierName" placeholder="全部供应商" clearable class="fl-select-sm" @change="reload">
              <el-option v-for="name in supplierOptions" :key="name" :label="name" :value="name" />
            </el-select>
            <el-input v-model="filters.keyword" placeholder="单号 / 项目 / 批次" clearable class="fl-input" @keyup.enter="reload" @clear="reload" />
            <el-button :icon="Search" @click="reload">查询</el-button>
            <el-button :icon="Download" :loading="exporting" @click="onExport">导出CSV</el-button>
            <el-button v-if="canCreate" type="primary" :icon="Upload" @click="$router.push('/supplier/projects')">去项目管理上传</el-button>
          </div>
        </div>
      </template>

      <div class="chips">
        <span v-for="chip in scopeChips" :key="chip.key" class="chip" :class="{ active: activeChip === chip.key }" @click="onChip(chip)">
          {{ chip.label }}<b v-if="chip.count !== null"> {{ chip.count }}</b>
        </span>
      </div>

      <el-table v-loading="loading" :data="list" border size="small">
        <el-table-column label="结算单号" prop="billNo" width="128" />
        <!-- 项目：弹性列，宽度由 el-table 按剩余空间分配（空间不足时自动压缩并截断） -->
        <el-table-column label="项目" prop="projectName" width="150" show-overflow-tooltip />
        <el-table-column label="批次名称" prop="batchName" width="96" show-overflow-tooltip />
        <el-table-column label="供应商" prop="supplierName" width="86" show-overflow-tooltip />
        <el-table-column label="金额(元)" width="102" align="right">
          <template #default="s"><span class="money">¥{{ formatMoney(s.row.totalAmount) }}</span></template>
        </el-table-column>
        <!-- 进度列：圆点 + 短标签，不必悬停即可看懂卡在哪一环（原 150px 挤 7 个点） -->
        <el-table-column label="结算进度" width="176">
          <template #default="s"><BillChainProgress :chain="s.row.chain" :status="s.row.status" labelled /></template>
        </el-table-column>
        <!-- 当前环节：状态标签 + 处理人各占一行，超长单行截断（悬停看全文） -->
        <el-table-column label="当前环节" width="132" class-name="cell-nowrap" show-overflow-tooltip>
          <template #default="s">
            <span class="stage-tag" :class="`stage-tag--${getBillStatusType(s.row.status)}`"
              :title="s.row.currentHandler ? `${getBillStatusText(s.row.status)} · ${s.row.currentHandler}` : getBillStatusText(s.row.status)">
              {{ getBillStatusText(s.row.status) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="96">
          <template #default="s">
            <div class="op-cell">
              <el-button v-if="s.row.isMyTurn" text type="success" @click="openDetail(s.row.id, true)">去确认</el-button>
              <el-button v-else text type="primary" @click="openDetail(s.row.id)">查看</el-button>
              <!-- 加急催办：单据没走完、当前环节又不是自己时可用（图标按钮，省宽度） -->
              <el-tooltip v-if="canUrgeRow(s.row)" :content="s.row.urgeCount ? `加急催办当前环节（已催办 ${s.row.urgeCount} 次）` : '加急催办当前环节的处理人'" placement="top">
                <el-button text type="warning" :icon="Bell" class="op-urge" @click="onUrgeRow(s.row)" />
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" description="暂无结算确认单" :image-size="80" />

      <el-pagination
        v-if="total > filters.pageSize"
        class="pager"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="filters.pageSize"
        :current-page="filters.page"
        @current-change="onPageChange"
      />
    </el-card>

    <!-- 详情抽屉 -->
    <!-- 结算确认单详情（与项目管理页共用） -->
    <BillDetailDrawer v-model="drawerVisible" :bill-id="drawerBillId" @changed="onDetailChanged" />

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Download, Upload, Bell } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { ROLE_TYPE, BILL_STAGES, BILL_STATUS_BY_STAGE, stagesOf, hasRole, hasAnyRole, getBillStatusText, getBillStatusType, formatMoney } from '@/utils/constants'
import { listBillsApi, getBillStatsApi, billExportPath, urgeBillApi } from '@/api/finance'
import { listProjectOptionsApi } from '@/api/projects'
import { useDownload } from '@/composables/useDownload'
import { useResponsive } from '@/composables/useResponsive'
import BillChainProgress from '@/components/finance/BillChainProgress.vue'
import BillDetailDrawer from '@/components/finance/BillDetailDrawer.vue'

const route = useRoute()
const userStore = useUserStore()
const { downloadFile } = useDownload()
const { statColumns, descColumns, drawerSize } = useResponsive()

// 列表列宽改用固定值（见模板注释），不再按屏宽缩放；tableScale 仍供上传弹窗等组件使用

// 账号可持多角色：供应商侧只看自家单据，内部角色看全部
const isSupplierOnly = computed(() => userStore.roles.every(r => r === ROLE_TYPE.VENDOR_TL))
const canCreate = computed(() => hasAnyRole(userStore.userInfo, [ROLE_TYPE.VENDOR_TL, ROLE_TYPE.CLIENT_PM]))
// 该账号在确认链上可操作的节点（可能多个 → 环环相扣）
const myStages = computed(() => stagesOf(userStore.userInfo))
const myStage = computed(() => myStages.value[0] || null)

const list = ref([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const stats = ref({ myTodoCount: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0, approvedAmount: 0, pendingAmount: 0 })
const supplierOptions = ref([])
const projectOptions = ref([])
const activeChip = ref('all')

const filters = reactive({ page: 1, pageSize: 20, keyword: '', supplierName: '', projectId: null, status: 'all', scope: '' })

const statCards = computed(() => [
  { key: 'todo', val: stats.value.myTodoCount || 0, label: myStage.value ? '待我确认' : '待确认', color: '#e6a23c', scope: 'todo', money: '¥' + formatMoney(stats.value.myTodoAmount) },
  { key: 'pending', val: stats.value.pendingCount || 0, label: '确认中', color: '#409eff', status: 'PENDING', money: '¥' + formatMoney(stats.value.pendingAmount) },
  { key: 'approved', val: stats.value.approvedCount || 0, label: '已通过', color: '#67c23a', status: 'APPROVED', money: '¥' + formatMoney(stats.value.approvedAmount) },
  { key: 'rejected', val: stats.value.rejectedCount || 0, label: '已驳回', color: '#f56c6c', status: 'REJECTED', money: '¥' + formatMoney(stats.value.amountByStatus?.REJECTED) }
])

// 四个确认环节的待办分布（环节 → 单数 → 金额）
const nodeStats = computed(() => BILL_STAGES.map((st, i) => ({
  label: st.label,
  short: st.short,
  status: BILL_STATUS_BY_STAGE[i],
  count: stats.value.byStatus?.[BILL_STATUS_BY_STAGE[i]] || 0,
  amount: stats.value.amountByStatus?.[BILL_STATUS_BY_STAGE[i]] || 0
})))

function onNodeFilter(node) {
  // 再次点击同一节点则取消筛选
  const next = filters.status === node.status ? 'all' : node.status
  activeChip.value = ''
  filters.scope = ''
  filters.status = next
  reload()
}

const scopeChips = computed(() => {
  const chips = [
    { key: 'all', label: '全部', count: null },
    { key: 'todo', label: '待我确认', count: stats.value.myTodoCount || 0 },
    { key: 'pending', label: '确认中', count: stats.value.pendingCount || 0 },
    { key: 'approved', label: '已通过', count: stats.value.approvedCount || 0 },
    { key: 'rejected', label: '已驳回', count: stats.value.rejectedCount || 0 }
  ]
  return myStage.value ? chips : chips.filter(c => c.key !== 'todo')
})

// 详情抽屉（组件内自取数据与操作）
const drawerVisible = ref(false)
const drawerBillId = ref(null)

// el-steps 的 active：第0步为"供应商提交"，之后每完成一个确认节点 +1
async function loadStats() {
  try {
    const { data } = await getBillStatsApi()
    stats.value = data || {}
    syncSupplierOptions(data)
    syncProjectOptions(data)
  } catch { /* 统计失败不阻塞列表 */ }
}

// 项目下拉取自统计数据，避免额外请求（订单量少时也能覆盖全部项目）
function syncProjectOptions(statsData) {
  const rows = statsData?.projects || []
  rows.forEach(r => {
    if (r.projectId && !projectOptions.value.some(p => p.id === r.projectId)) {
      projectOptions.value.push({ id: r.projectId, name: r.projectName })
    }
  })
}

async function loadList() {
  loading.value = true
  try {
    const { data, meta } = await listBillsApi({
      page: filters.page,
      pageSize: filters.pageSize,
      keyword: filters.keyword,
      supplierName: filters.supplierName,
      projectId: filters.projectId,
      status: filters.status,
      scope: filters.scope
    })
    list.value = data || []
    total.value = meta?.total || 0
  } catch { list.value = []; total.value = 0 } finally { loading.value = false }
}

function reload() { filters.page = 1; loadList() }


function onChip(chip) {
  activeChip.value = chip.key
  filters.scope = chip.key === 'todo' ? 'todo' : ''
  filters.status = chip.key === 'all' || chip.key === 'todo' ? 'all' : chip.key === 'pending' ? 'PENDING' : chip.key.toUpperCase()
  reload()
}

async function onPageChange(page) { filters.page = page; loadList() }

// 供应商下拉取自统计数据（已按当前角色数据范围聚合），不再单独请求供应商接口
function syncSupplierOptions(statsData) {
  const rows = statsData?.suppliers || []
  rows.forEach(r => {
    if (r.supplierName && !supplierOptions.value.includes(r.supplierName)) {
      supplierOptions.value.push(r.supplierName)
    }
  })
}

// ===== 加急催办：催当前环节的处理人（后端 10 分钟内同一单只允许一次）=====
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
  } catch { /* 错误提示由 request 统一处理 */ }
}

function openDetail(id) {
  drawerBillId.value = id
  drawerVisible.value = true
}

// 抽屉内发生变更（确认/驳回/重新提交/编辑/删除）→ 刷新列表与统计
async function onDetailChanged() {
  await Promise.all([loadList(), loadStats()])
}

function openReject() { rejectReason.value = ''; rejectDialog.value = true }

async function onExport() {
  exporting.value = true
  try {
    const path = billExportPath({
      keyword: filters.keyword, supplierName: filters.supplierName,
      projectId: filters.projectId, status: filters.status, scope: filters.scope
    })
    await downloadFile(path, `验收结算单_${new Date().toISOString().slice(0, 10)}.csv`)
    ElMessage.success('导出成功')
  } catch (e) { ElMessage.error(e.message || '导出失败') } finally { exporting.value = false }
}

// 全部项目（含暂无结算单的项目），与统计汇总的项目合并后用于筛选下拉
async function loadProjectOptions() {
  try {
    const { data } = await listProjectOptionsApi()
    const merged = [...(data || []).map(p => ({ id: p.id, name: p.name })), ...projectOptions.value]
    const seen = new Set()
    projectOptions.value = merged.filter(p => (seen.has(p.id) ? false : seen.add(p.id)))
  } catch { /* 项目下拉失败不阻塞页面 */ }
}

onMounted(async () => {
  // 支持从项目管理页带 ?projectId= 只看该项目
  const presetProject = Number(route.query.projectId || 0)
  if (presetProject) filters.projectId = presetProject
  await Promise.all([loadStats(), loadList(), loadProjectOptions()])
  syncProjectOptionsFromQuery(presetProject)
  // 支持从其他页面带 ?id= 直接打开详情
  const id = Number(route.query.id || 0)
  if (id) await nextTick().then(() => openDetail(id))
})

// 若 URL 指定的项目尚未出现在下拉里，补进去，保证筛选回显正确
function syncProjectOptionsFromQuery(projectId) {
  if (!projectId || projectOptions.value.some(p => p.id === projectId)) return
  const hit = (stats.value.projects || []).find(p => p.projectId === projectId)
  if (hit) projectOptions.value.push({ id: projectId, name: hit.projectName })
}
</script>

<style scoped>
/* 列宽严格按设定值分配：否则 el-table 默认按内容撑列，弹性列会各自扩张，
   总宽超出容器后就出现横向滚动（此前列表必须拖动才能看全的原因） */
:deep(.el-table table) { table-layout: fixed; }
.bills-page { display: flex; flex-direction: column; gap: 14px; }
.stat-row { display: grid; gap: 12px; }
.stat-card { text-align: center; cursor: pointer; }
.stat-card :deep(.el-card__body) { padding: 12px 14px; }
.stat-head { display: flex; align-items: baseline; justify-content: center; gap: 3px; }
.stat-num { font-size: 26px; font-weight: 700; line-height: 1.1; }
.stat-unit { font-size: 12px; color: var(--text-3); }
.stat-label { color: var(--text-3); margin-top: 2px; font-size: 13px; }
.stat-money { margin-top: 4px; font-size: 12.5px; color: var(--text-2); font-weight: 600; }

/* 各环节待办 */
.node-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; }
.node-item {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 14px; cursor: pointer; background: var(--surface-2);
  transition: all 0.18s ease;
}
.node-item:hover { border-color: var(--primary-border, #ccd9f8); background: var(--primary-bg, #edf2fe); }
.node-item.active { border-color: var(--primary, #3d63dd); background: var(--primary-bg, #edf2fe); box-shadow: 0 0 0 2px rgba(61, 99, 221, 0.12); }
.node-item.zero { opacity: 0.62; }
.node-name { font-size: 13px; font-weight: 600; color: var(--text-1); }
.node-count { margin-top: 4px; font-size: 12.5px; color: var(--text-2); }
.node-count b { font-size: 17px; color: var(--primary, #3d63dd); margin-right: 2px; }
.node-money { margin-top: 2px; font-size: 12px; color: var(--text-3); }
@media (max-width: 1180px) { .node-row { grid-auto-flow: row; grid-template-columns: repeat(2, 1fr); } }

.tip { font-size: 12px; color: var(--text-3); }
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1 1 auto; justify-content: flex-end; }
/* 筛选控件可伸缩：窄屏自动收缩而不是整行折行 */
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
/* 表格里的两行紧凑排版：主信息 + 次要信息，避免长文本撑宽列 */
.cell-strong { color: var(--text-1, #303133); line-height: 1.5; }
.cell-sub { color: var(--text-3, #909399); font-size: 12px; line-height: 1.5; }
/* 当前环节列：状态标签 + 处理人各自单行，超长用省略号（hover 有原生 title）
   el-table 的 .cell 默认允许换行，必须把 nowrap 落到 .cell 上，否则内层 div 设了也没用 */
.cell-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 当前环节单元格：宽度锁死在列宽内，子项一律单行省略
   （el-table 的 .cell 默认会因内容变宽而撑破列宽，导致压住相邻列） */
/* 单行状态标签：占满列宽即省略，绝不换行（换行会把整行撑高） */
.stage-tag {
  display: block;
  max-width: 100%;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box;
}
.stage-tag--success { background: rgba(24, 160, 88, 0.12); color: #18a058; }
.stage-tag--warning { background: rgba(230, 162, 60, 0.14); color: #b88230; }
.stage-tag--danger { background: rgba(214, 69, 80, 0.12); color: #d64550; }
.stage-tag--info { background: rgba(144, 147, 153, 0.14); color: #73767a; }
/* 操作列：按钮排一行，不因换行把行高撑到两倍 */
.op-cell { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
.op-cell :deep(.el-button) { padding: 2px 4px; }
.op-urge { margin-left: 0 !important; }
.pager { margin-top: 12px; justify-content: flex-end; }
.mb12 { margin-bottom: 12px; }
.mb16 { margin-bottom: 14px; }
</style>
