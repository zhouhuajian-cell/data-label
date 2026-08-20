<template>
  <div v-loading="loading">
    <el-row :gutter="12" class="mt">
      <el-col :span="5"><el-card shadow="never"><div class="stat"><div class="num">{{ stats.total }}</div><div class="lbl">任务总量</div></div></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><div class="stat"><div class="num">{{ stats.mileageSummary.acceptanceCount }}</div><div class="lbl">验收任务数</div></div></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><div class="stat"><div class="num">{{ stats.mileageSummary.totalMileage }}</div><div class="lbl">验收总里程(km)</div></div></el-card></el-col>
      <el-col :span="5"><el-card shadow="never"><div class="stat"><div class="num">{{ stats.reworkRate.acceptanceRejectRate }}</div><div class="lbl">验收驳回率</div></div></el-card></el-col>
      <el-col :span="4"><el-card shadow="never"><div class="stat"><div class="num">{{ stats.reworkRate.perceptionRepairRate }}</div><div class="lbl">感知返修率</div></div></el-card></el-col>
    </el-row>

    <el-row :gutter="12" class="mt">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>任务状态分布</template>
          <div ref="chartRef" style="height: 320px"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>环节平均耗时（天）</template>
          <el-table :data="durationRows" size="small">
            <el-table-column prop="label" label="环节" />
            <el-table-column prop="value" label="平均耗时(天)" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { gndStatsApi } from '@/api/gnd'
import { GND_STATUS_MAP } from '@/utils/constants'

const loading = ref(false)
const stats = reactive({ total: 0, statusDistribution: {}, avgDurationDays: {}, reworkRate: { acceptanceRejectRate: 0, perceptionRepairRate: 0 }, mileageSummary: { acceptanceCount: 0, totalMileage: 0, avgMileage: 0 } })
const chartRef = ref(null)
let chart = null

const durationRows = computed(() => [
  { label: '供应商处理', value: stats.avgDurationDays.supplier ?? '-' },
  { label: '优化环节', value: stats.avgDurationDays.optimization ?? '-' },
  { label: '验收环节', value: stats.avgDurationDays.acceptance ?? '-' },
  { label: '入库环节', value: stats.avgDurationDays.warehouse ?? '-' },
  { label: '全流程', value: stats.avgDurationDays.total ?? '-' }
])

function renderChart() {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  const keys = Object.keys(stats.statusDistribution || {})
  chart.setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '68%'],
      data: keys.map(k => ({ name: GND_STATUS_MAP[k] || k, value: stats.statusDistribution[k] }))
    }]
  })
}

async function load() {
  loading.value = true
  try {
    const { data } = await gndStatsApi({})
    Object.assign(stats, data)
    renderChart()
  } catch { /* 已提示 */ } finally { loading.value = false }
}

onMounted(load)
onBeforeUnmount(() => { if (chart) { chart.dispose(); chart = null } })
</script>

<style scoped>
.mt { margin-top: 12px; }
.stat { text-align: center; padding: 8px 0; }
.stat .num { font-size: 28px; font-weight: 700; color: #303133; }
.stat .lbl { color: #909399; font-size: 13px; margin-top: 4px; }
</style>
