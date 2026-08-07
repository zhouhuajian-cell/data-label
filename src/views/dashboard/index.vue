<template>
  <div class="dash-wrap">
    <div class="card-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="label">{{ card.label }}</div>
      </el-card>
    </div>

    <!-- 甲方 PM：供应商质量排行（PRD 4.3） -->
    <el-card v-if="data.supplierRanking" shadow="hover" style="margin-bottom:16px">
      <template #header><span>供应商质量排行榜（一次通过率 FFR）</span></template>
      <el-table :data="data.supplierRanking" border size="small">
        <el-table-column label="供应商" prop="name" width="120" />
        <el-table-column label="一次通过率 FFR" width="140">
          <template #default="s"><span :style="{color: ffrColor(s.row.ffr)}">{{ s.row.ffr === null ? '-' : (s.row.ffr*100).toFixed(1)+'%' }}</span></template>
        </el-table-column>
        <el-table-column label="验收量" prop="acceptedCount" width="90" />
        <el-table-column label="返工积压" prop="reworkBacklog" width="90" />
        <el-table-column label="平均返工耗时" width="120"><template #default="s">{{ s.row.avgReworkHours }}h</template></el-table-column>
        <el-table-column label="已结算金额"><template #default="s">¥{{ s.row.settledAmount }}</template></el-table-column>
      </el-table>
    </el-card>

    <div class="chart-row">
      <el-card shadow="hover">
        <template #header><span>任务状态分布</span></template>
        <div ref="pieChartRef" style="height:300px"></div>
      </el-card>
      <el-card shadow="hover">
        <template #header><span>错误类型 Top（驳回原因分析）</span></template>
        <div ref="errorChartRef" style="height:300px"></div>
      </el-card>
    </div>

    <!-- 供应商 TL：团队人效排行（PRD 4.3） -->
    <el-card v-if="data.teamPerf" shadow="hover" style="margin-top:16px">
      <template #header><span>团队成员人效排行</span></template>
      <el-table :data="data.teamPerf" border size="small">
        <el-table-column label="标注员" prop="userName" width="120" />
        <el-table-column label="提交量" prop="submitted" width="90" />
        <el-table-column label="有效工时" width="100"><template #default="s">{{ s.row.hours }}h</template></el-table-column>
        <el-table-column label="人效(条/小时)" width="120"><template #default="s">{{ s.row.perHour }}</template></el-table-column>
        <el-table-column label="个人FFR" width="100"><template #default="s">{{ s.row.ffr === null ? '-' : s.row.ffr+'%' }}</template></el-table-column>
        <el-table-column label="返工数" prop="reworkCount" width="90" />
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top:16px">
      <template #header><span>最近任务</span></template>
      <el-table :data="data.recentTasks" border size="small">
        <el-table-column label="Nano ID" prop="nanoId" width="90" />
        <el-table-column label="任务名称" prop="taskName" min-width="180" show-overflow-tooltip />
        <el-table-column label="供应商" prop="supplierName" width="100" />
        <el-table-column label="状态" width="100"><template #default="s"><el-tag :type="getStateType(s.row.state)" size="small">{{ getStateText(s.row.state) }}</el-tag></template></el-table-column>
        <el-table-column label="截止" prop="deadline" width="150" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { getTaskStateText, getTaskStateType } from '@/utils/constants'
import { getDashboardDataApi } from '@/api/dashboard.js'

const getStateText = getTaskStateText
const getStateType = getTaskStateType

const pieChartRef = ref(null)
const errorChartRef = ref(null)
let pieChart = null, errorChart = null

const data = reactive({ supplierRanking: null, teamPerf: null, labelDist: null, costStats: null, errorTop: [], itemsByStatus: {}, recentTasks: [], projectCount: 0, totalTasks: 0, reworkBacklog: 0 })

const statCards = ref([
  { key: 'projects', val: 0, label: '项目总数', color: '#409eff' },
  { key: 'total', val: 0, label: '任务总数', color: '#67c23a' },
  { key: 'working', val: 0, label: '进行中', color: '#e6a23c' },
  { key: 'rework', val: 0, label: '返工积压', color: '#f56c6c' }
])

const STATUS_LABELS = { unassigned: '待指派', annotating: '标注中', vendorQA: '供应商质检', clientQA: '甲方质检', accepted: '已验收', rejected: '驳回' }

function ffrColor(ffr) { return ffr === null ? '#909399' : ffr >= 0.95 ? '#67c23a' : ffr >= 0.9 ? '#e6a23c' : '#f56c6c' }

async function loadData() {
  const { data: payload } = await getDashboardDataApi()
  Object.assign(data, payload)
  const st = data.itemsByStatus || {}
  statCards.value[0].val = data.projectCount
  statCards.value[1].val = data.totalTasks
  statCards.value[2].val = (st.annotating || 0) + (st.unassigned || 0) + (st.vendorQA || 0)
  statCards.value[3].val = data.reworkBacklog || 0
  await nextTick()
  initPie(st)
  initError(data.errorTop || [])
}

function initError(d) {
  if (!errorChartRef.value) return
  errorChart = echarts.init(errorChartRef.value)
  errorChart.setOption({ tooltip: { trigger: 'item' }, legend: { bottom: 0 }, series: [{ type: 'pie', radius: '60%', data: d.length ? d : [{ name: '暂无', value: 1 }], label: { formatter: '{b}: {c}' } }] })
}

function initPie(d) {
  if (!pieChartRef.value) return
  pieChart = echarts.init(pieChartRef.value)
  pieChart.setOption({
    tooltip: { trigger: 'item' }, legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['40%', '70%'], data: Object.entries(d).filter(([k]) => k !== 'overdue').map(([k, v]) => ({ name: STATUS_LABELS[k] || k, value: v })), label: { formatter: '{b}: {c}' } }]
  })
}
function handleResize() { pieChart?.resize(); errorChart?.resize() }
onMounted(() => { loadData(); window.addEventListener('resize', handleResize) })
onUnmounted(() => { window.removeEventListener('resize', handleResize); pieChart?.dispose(); errorChart?.dispose() })
</script>

<style scoped>
.card-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.stat-card { text-align: center; }
.num { font-size: 32px; font-weight: bold; }
.label { color: #909399; margin-top: 8px; font-size: 14px; }
.chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
</style>
