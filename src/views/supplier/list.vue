<template>
  <div class="summary-page">
    <!-- 顶部：全量累积结算指标 -->
    <div class="stat-row">
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">累计结算金额</div>
        <div class="stat-num">¥{{ formatMoney(totals.amount) }}</div>
        <div class="stat-sub">
          已结算 ¥{{ formatMoney(totals.settledAmount) }} · 在途 ¥{{ formatMoney(totals.pendingAmount) }}
        </div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">结算完成度</div>
        <div class="stat-num">{{ totals.settleRate }}%</div>
        <el-progress :percentage="Math.min(totals.settleRate, 100)" :show-text="false" :stroke-width="8" />
        <div class="stat-sub">{{ totals.settledCount }} 单已通过 / {{ totals.billCount }} 单</div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">供应商</div>
        <div class="stat-num">{{ totals.supplierCount }} <span class="unit">家</span></div>
        <div class="stat-sub">在途 {{ totals.pendingCount }} 单 · 驳回 {{ totals.rejectedCount }} 单</div>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <div class="stat-label">成本中心</div>
        <div class="stat-num">{{ totals.costCenterCount }} <span class="unit">个</span></div>
        <div class="stat-sub">金额合计 ¥{{ formatMoney(costCenterTotal) }}</div>
      </el-card>
    </div>

    <!-- 筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="filter-bar">
        <el-select v-model="filters.projectId" placeholder="全部项目" clearable class="fl-select" @change="load">
          <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-select v-model="filters.period" placeholder="全部结算周期" clearable class="fl-select" @change="load">
          <el-option v-for="p in periodOptions" :key="p" :label="p" :value="p" />
        </el-select>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <span class="tip">口径：金额优先取统结方提交金额；未走统结环节的取「应付金额」（未核算用基础金额）；已结算 = 流程全部通过</span>
      </div>
    </el-card>

    <!-- 图表：成本中心金额分布 + 周期累积 -->
    <div class="chart-row">
      <el-card shadow="never" class="chart-card">
        <template #header><span class="card-title">成本中心金额分布</span></template>
        <div ref="pieRef" class="chart-box"></div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <template #header><span class="card-title">按供应商分布</span></template>
        <div ref="barRef" class="chart-box"></div>
      </el-card>
    </div>

    <!-- 供应商累积结算 -->
    <el-card shadow="never" class="table-card">
      <template #header><span class="card-title">供应商结算明细</span></template>
      <el-table :data="suppliers" border size="small" :default-sort="{ prop: 'amount', order: 'descending' }">
        <el-table-column label="供应商" prop="supplierName" min-width="130" fixed="left" />
        <el-table-column label="单据数" prop="billCount" width="90" align="right" />
        <el-table-column label="已通过 / 在途" width="120" align="right">
          <template #default="s">{{ s.row.settledCount }} / {{ s.row.pendingCount }}</template>
        </el-table-column>
        <el-table-column label="累计金额" width="130" align="right" sortable prop="amount">
          <template #default="s"><b>¥{{ formatMoney(s.row.amount) }}</b></template>
        </el-table-column>
        <el-table-column label="已结算" width="125" align="right">
          <template #default="s">¥{{ formatMoney(s.row.settledAmount) }}</template>
        </el-table-column>
        <el-table-column label="在途" width="120" align="right">
          <template #default="s">¥{{ formatMoney(s.row.pendingAmount) }}</template>
        </el-table-column>
        <el-table-column label="完成度" width="130">
          <template #default="s">
            <el-progress :percentage="Math.min(s.row.settleRate, 100)" :stroke-width="6" :text-inside="true" />
          </template>
        </el-table-column>
        <el-table-column label="结算周期" min-width="150" show-overflow-tooltip>
          <template #default="s">{{ s.row.periods.length ? s.row.periods.join('、') : '—' }}</template>
        </el-table-column>
        <el-table-column label="项目" min-width="150" show-overflow-tooltip>
          <template #default="s">{{ s.row.projects.length ? s.row.projects.join('、') : '—' }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!suppliers.length" :image-size="70" description="暂无结算数据" />
    </el-card>

    <!-- 成本中心明细 -->
    <el-card shadow="never" class="table-card">
      <template #header><span class="card-title">成本中心金额分布明细</span></template>
      <el-table :data="costCenters" border size="small">
        <el-table-column label="成本中心" prop="name" min-width="120" />
        <el-table-column label="金额" width="130" align="right" sortable prop="amount">
          <template #default="s">¥{{ formatMoney(s.row.amount) }}</template>
        </el-table-column>
        <el-table-column label="金额占比" width="110" align="right">
          <template #default="s">{{ s.row.amountPercent }}%</template>
        </el-table-column>
        <el-table-column label="平均比例" width="100" align="right">
          <template #default="s">{{ s.row.avgRatio }}%</template>
        </el-table-column>
        <el-table-column label="涉及单据" prop="billCount" width="100" align="right" />
        <el-table-column label="涉及供应商" prop="supplierCount" width="110" align="right" />
        <el-table-column label="金额分布" min-width="180">
          <template #default="s">
            <el-progress :percentage="s.row.amountPercent" :stroke-width="10" />
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!costCenters.length" :image-size="70" description="暂无成本中心数据" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { Refresh } from '@element-plus/icons-vue'
import { settlementSummaryApi } from '@/api/finance'
import { listProjectOptionsApi } from '@/api/projects'
import { formatMoney } from '@/utils/constants'

const pieRef = ref(null)
const barRef = ref(null)
let pieChart = null
let barChart = null

const filters = reactive({ projectId: null, period: '' })
const projectOptions = ref([])
const periodOptions = ref([])
const totals = ref({
  amount: 0, settledAmount: 0, pendingAmount: 0, settleRate: 0, billCount: 0,
  settledCount: 0, pendingCount: 0, rejectedCount: 0, supplierCount: 0,
  costCenterCount: 0
})
const suppliers = ref([])
// 供应商 × 成本中心 分布（图表「按供应商分布」的数据源）
const supplierCostCenters = ref([])
const costCenters = ref([])
const periods = ref([])


// 成本中心金额合计（顶部「成本中心」卡片用）
const costCenterTotal = computed(() => costCenters.value.reduce((s, x) => s + (Number(x.amount) || 0), 0))


function renderPie () {
  if (!pieRef.value) return
  if (!pieChart) pieChart = echarts.init(pieRef.value)
  const data = costCenters.value.filter(x => x.amount > 0).map(x => ({ name: x.name, value: x.amount }))
  pieChart.setOption({
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>¥${formatMoney(p.value)}（${p.percent}%）` },
    legend: { bottom: 0, type: 'scroll' },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      label: { formatter: '{b}\n{d}%', fontSize: 11 },
      data: data.length ? data : [{ name: '暂无数据', value: 0 }]
    }]
  }, true)
}

// 按供应商维度的柱状图：每家一根柱子，堆叠展示「已结 / 未结」（两者之和即累计金额）
// 按供应商分布：横轴为供应商，每家一根柱子，柱内堆叠「已结（绿）/ 未结（黄）」。
// 成本中心明细放在悬停提示里（鼠标放上去即可看到各成本中心各多少钱）。
function renderBar () {
  if (!barRef.value) return
  if (!barChart) barChart = echarts.init(barRef.value)
  const rows = [...suppliers.value].sort((a, b) => (b.amount || 0) - (a.amount || 0))
  const ccRows = supplierCostCenters.value
  const settled = rows.map(r => Number(r.settledAmount) || 0)
  // 未结 = 累计 − 已结（在途与驳回都算未结，避免出现负数）
  const unsettled = rows.map((r, i) => Math.max(0, (Number(r.amount) || 0) - settled[i]))
  barChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps[0]?.dataIndex
        const r = rows[i]
        if (!r) return ''
        // 按成本中心列出明细
        const mine = ccRows.filter(x => x.supplierName === r.supplierName)
        const lines = mine.map(x => {
          const un = Math.max(0, (Number(x.amount) || 0) - (Number(x.settledAmount) || 0))
          return `&nbsp;&nbsp;${x.costCenter}：¥${formatMoney(x.amount)}（已结 ¥${formatMoney(x.settledAmount)} · 未结 ¥${formatMoney(un)}）`
        })
        return `${r.supplierName}<br/>` +
          `已结 ¥${formatMoney(settled[i])} · 未结 ¥${formatMoney(unsettled[i])}<br/>` +
          `合计：¥${formatMoney(r.amount)}` +
          (lines.length ? `<br/><span style="color:#909399">按成本中心</span><br/>${lines.join('<br/>')}` : '')
      }
    },
    legend: { bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 50 },
    xAxis: {
      type: 'category',
      data: rows.map(r => r.supplierName),
      axisLabel: { fontSize: 11, interval: 0, rotate: rows.length > 5 ? 30 : 0 }
    },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? (v / 10000) + '万' : v) } },
    series: [
      { name: '已结', type: 'bar', stack: 'amount', data: settled, itemStyle: { color: '#67c23a' }, barMaxWidth: 52 },
      { name: '未结', type: 'bar', stack: 'amount', data: unsettled, itemStyle: { color: '#e6a23c' }, barMaxWidth: 52 }
    ]
  }, true)
}

async function load () {
  const { data } = await settlementSummaryApi({ projectId: filters.projectId, period: filters.period })
  const d = data || {}
  totals.value = { ...totals.value, ...(d.totals || {}) }
  suppliers.value = d.suppliers || []
  supplierCostCenters.value = d.supplierCostCenters || []
  costCenters.value = d.costCenters || []
  periods.value = d.periods || []
  if (!periodOptions.value.length) {
    periodOptions.value = periods.value.map(p => p.period).filter(p => p && p !== '未填周期')
  }
  await nextTick()
  renderPie()
  renderBar()
}

function handleResize () { pieChart?.resize(); barChart?.resize() }

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  try { const { data } = await listProjectOptionsApi(); projectOptions.value = data || [] } catch { /* 忽略 */ }
  await load()
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  pieChart?.dispose()
  barChart?.dispose()
})
</script>

<style scoped>
.summary-page { display: flex; flex-direction: column; gap: 14px; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.stat-card :deep(.el-card__body) { padding: 14px 16px; }
.stat-label { font-size: 13px; color: var(--text-3); }
.stat-num { font-size: 24px; font-weight: 700; margin: 6px 0 4px; color: var(--text-1); }
.stat-num .unit { font-size: 13px; font-weight: 400; color: var(--text-3); }
.stat-sub { font-size: 12px; color: var(--text-3); margin-top: 4px; }
.filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fl-select { width: 190px; }
.tip { font-size: 12px; color: var(--text-3); }
.chart-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.chart-box { height: 280px; }
.card-title { font-weight: 600; }
.table-card :deep(.el-card__body) { padding-top: 8px; }
@media (max-width: 1500px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
  .chart-row { grid-template-columns: 1fr; }
}
@media (max-width: 1180px) {
  .stat-row { grid-template-columns: 1fr; }
  .fl-select { width: 100%; }
}
</style>
