<template>
  <div class="performance-page">
    <div class="score-card-row">
      <el-card class="total-score-card" shadow="hover">
        <div class="score-label">团队综合 FFR</div>
        <div class="score-num">{{ teamFfr === null ? '-' : teamFfr + '%' }}</div>
        <el-tag :type="teamFfrLevel" size="large">{{ teamFfrLevelText }}级供应商</el-tag>
      </el-card>
      <el-card class="dim-card" shadow="hover">
        <div class="dim-label">团队提交量</div>
        <div class="dim-num">{{ totalSubmitted }}</div>
        <el-progress :percentage="Math.min(totalSubmitted*5,100)" color="#409eff" />
      </el-card>
      <el-card class="dim-card" shadow="hover">
        <div class="dim-label">返工积压</div>
        <div class="dim-num" style="color:#f56c6c">{{ totalRework }}</div>
        <el-progress :percentage="Math.min(totalRework*20,100)" color="#f56c6c" />
      </el-card>
      <el-card class="dim-card" shadow="hover">
        <div class="dim-label">平均人效(条/小时)</div>
        <div class="dim-num">{{ avgPerHour }}</div>
        <el-progress :percentage="Math.min(avgPerHour*10,100)" color="#67c23a" />
      </el-card>
    </div>

    <el-card shadow="hover" style="margin-top:16px">
      <template #header>团队成员人效排行（PRD 4.3 TL 视角）</template>
      <div ref="barRef" style="height:300px"></div>
    </el-card>

    <el-card shadow="hover" style="margin-top:16px">
      <template #header>成员明细</template>
      <el-table :data="teamPerf" border>
        <el-table-column label="标注员" prop="userName" width="120" />
        <el-table-column label="提交量" prop="submitted" width="100" />
        <el-table-column label="有效工时" width="110"><template #default="s">{{ s.row.hours }}h</template></el-table-column>
        <el-table-column label="人效(条/小时)" width="130"><template #default="s">{{ s.row.perHour }}</template></el-table-column>
        <el-table-column label="个人FFR" width="110"><template #default="s"><span :style="{color: ffrColor(s.row.ffr)}">{{ s.row.ffr === null ? '-' : s.row.ffr+'%' }}</span></template></el-table-column>
        <el-table-column label="返工数" prop="reworkCount" width="100" />
      </el-table>
    </el-card>

    <el-card shadow="hover" style="margin-top:16px">
      <template #header>错误类型 Top3（返工原因分析）</template>
      <el-table :data="errorTop3" border size="small">
        <el-table-column label="排名" type="index" width="80" />
        <el-table-column label="错误类型" prop="name" />
        <el-table-column label="出现次数" prop="value" width="120" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { getDashboardDataApi } from '@/api/dashboard.js'

const barRef = ref(null)
let barChart = null
const teamPerf = ref([])
const errorTop3 = ref([])

const totalSubmitted = computed(() => teamPerf.value.reduce((a, t) => a + t.submitted, 0))
const totalRework = computed(() => teamPerf.value.reduce((a, t) => a + t.reworkCount, 0))
const avgPerHour = computed(() => {
  const totalHours = teamPerf.value.reduce((a, t) => a + t.hours, 0)
  return totalHours > 0 ? Number((totalSubmitted.value / totalHours).toFixed(1)) : 0
})
const reviewedList = computed(() => teamPerf.value.filter(t => t.ffr !== null))
const teamFfr = computed(() => {
  if (!reviewedList.value.length) return null
  const sum = reviewedList.value.reduce((a, t) => a + t.ffr, 0)
  return Number((sum / reviewedList.value.length).toFixed(1))
})
const teamFfrLevel = computed(() => teamFfr.value === null ? 'info' : teamFfr.value >= 95 ? 'success' : teamFfr.value >= 90 ? 'warning' : 'danger')
const teamFfrLevelText = computed(() => teamFfr.value === null ? '-' : teamFfr.value >= 98 ? 'A' : teamFfr.value >= 95 ? 'A' : teamFfr.value >= 90 ? 'B' : 'C')

function ffrColor(ffr) { return ffr === null ? '#909399' : ffr >= 95 ? '#67c23a' : ffr >= 90 ? '#e6a23c' : '#f56c6c' }

async function loadData() {
  const { data } = await getDashboardDataApi()
  const res = { data }
  teamPerf.value = res.data?.teamPerf || []
  errorTop3.value = (res.data?.errorTop || []).slice(0, 3)
  await nextTick()
  initBar()
}

function initBar() {
  if (!barRef.value) return
  barChart = echarts.init(barRef.value)
  barChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['提交量', '人效(条/小时)'] },
    xAxis: { type: 'category', data: teamPerf.value.map(t => t.userName) },
    yAxis: [{ type: 'value', name: '提交量' }, { type: 'value', name: '条/小时' }],
    series: [
      { name: '提交量', type: 'bar', data: teamPerf.value.map(t => t.submitted), itemStyle: { color: '#409eff', borderRadius: [4,4,0,0] } },
      { name: '人效(条/小时)', type: 'line', yAxisIndex: 1, data: teamPerf.value.map(t => t.perHour), smooth: true, lineStyle: { color: '#67c23a' }, itemStyle: { color: '#67c23a' } }
    ]
  })
}

function handleResize() { barChart?.resize() }
onMounted(() => { loadData(); window.addEventListener('resize', handleResize) })
onUnmounted(() => { window.removeEventListener('resize', handleResize); barChart?.dispose() })
</script>

<style scoped>
.score-card-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.total-score-card { text-align: center; background: linear-gradient(135deg, #409eff, #2979eb); color: #fff; }
.total-score-card :deep(.el-card__body) { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.score-label { font-size: 14px; opacity: 0.9; }
.score-num { font-size: 44px; font-weight: bold; }
.dim-card { text-align: center; }
.dim-label { font-size: 14px; color: #666; margin-bottom: 10px; }
.dim-num { font-size: 24px; font-weight: bold; margin-bottom: 10px; color: #303133; }
</style>
