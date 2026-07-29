<template>
  <div class="supplier-dash">
    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <div class="body-row">
      <!-- 任务看板 -->
      <el-card shadow="hover" class="task-board">
        <template #header><span>任务看板</span></template>

        <div class="state-chips">
          <span class="chip" :class="{ active: taskFilter === '' }" @click="taskFilter = ''">全部 <b>{{ allTasks.length }}</b></span>
          <span class="chip chip-warning" :class="{ active: taskFilter === 'UNASSIGNED' }" @click="taskFilter = 'UNASSIGNED'">待接单 <b>{{ statusCounts.UNASSIGNED }}</b></span>
          <span class="chip chip-primary" :class="{ active: taskFilter === 'ANNOTATING' }" @click="taskFilter = 'ANNOTATING'">标注中 <b>{{ statusCounts.ANNOTATING }}</b></span>
          <span class="chip chip-warning" :class="{ active: taskFilter === 'VENDOR_QA' }" @click="taskFilter = 'VENDOR_QA'">待提交 <b>{{ statusCounts.VENDOR_QA }}</b></span>
          <span class="chip chip-primary" :class="{ active: taskFilter === 'CLIENT_QA' }" @click="taskFilter = 'CLIENT_QA'">待验收 <b>{{ statusCounts.CLIENT_QA }}</b></span>
          <span class="chip chip-danger" :class="{ active: taskFilter === 'REJECTED' }" @click="taskFilter = 'REJECTED'">驳回 <b>{{ statusCounts.REJECTED }}</b></span>
          <span class="chip chip-success" :class="{ active: taskFilter === 'ACCEPTED' }" @click="taskFilter = 'ACCEPTED'">已验收 <b>{{ statusCounts.ACCEPTED }}</b></span>
        </div>

        <el-table :data="filteredTasks" border size="small">
          <el-table-column label="任务名称" prop="taskName" min-width="180" show-overflow-tooltip />
          <el-table-column label="类型" prop="annotateType" width="110" />
          <el-table-column label="样本量" prop="sampleCount" width="75" />
          <el-table-column label="状态" width="90"><template #default="s"><el-tag :type="getStateType(s.row.state)" size="small">{{ getStateText(s.row.state) }}</el-tag></template></el-table-column>
          <el-table-column label="截止" prop="deadline" width="135" />
          <el-table-column label="操作" width="180">
            <template #default="s">
              <el-button v-if="s.row.state === 'UNASSIGNED'" size="small" type="primary" @click="onAccept(s.row)">接单</el-button>
              <el-button v-if="s.row.annotateType === '2D拉框' && ['ANNOTATING','REJECTED'].includes(s.row.state)" size="small" type="success" @click="$router.push('/workbench/' + s.row.id)">进入标注</el-button>
              <el-button size="small" @click="$router.push('/task/detail/' + s.row.id)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!allTasks.length" description="暂无任务，等待甲方派发" :image-size="80" />
      </el-card>

      <!-- 右侧：通知 + 快捷入口 -->
      <div class="side-col">
        <el-card shadow="hover" class="notif-card">
          <template #header>
            <div class="card-head">
              <span>最新消息</span>
              <el-button text size="small" type="primary" @click="$router.push('/message')">查看全部</el-button>
            </div>
          </template>
          <div v-if="recentNotifs.length" class="notif-list">
            <div v-for="n in recentNotifs" :key="n.id" class="notif-item" :class="{ unread: !n.read }">
              <el-icon :color="n.read ? '#c0c4cc' : '#f56c6c'" :size="14"><Warning /></el-icon>
              <span class="notif-text">{{ n.title }}</span>
              <span class="notif-time">{{ n.createdAt?.slice(5, 16) }}</span>
            </div>
          </div>
          <el-empty v-else description="暂无消息" :image-size="40" />
        </el-card>

        <el-card shadow="hover" class="quick-card">
          <template #header><span>快捷入口</span></template>
          <div class="quick-links">
            <el-button :icon="EditPen" @click="$router.push('/workbench')" v-if="userStore.userInfo.roleType === 4">标注工作台</el-button>
            <el-button :icon="Select" @click="$router.push('/qa')" v-if="userStore.userInfo.roleType === 5">质检工作台</el-button>
            <el-button :icon="DataBoard" @click="$router.push('/supplier/performance')">绩效分析</el-button>
            <el-button :icon="Money" @click="$router.push('/finance/bill')">收款结算</el-button>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { EditPen, Select, DataBoard, Money, Warning } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { request } from '@/api/client.js'
import { acceptTaskApi } from '@/api/tasks.js'
import { fetchNotifications } from '@/api/notifications.js'
import { getTaskStateText as getStateText, getTaskStateType as getStateType } from '@/utils/constants.js'

const userStore = useUserStore()
const allTasks = ref([])
const taskFilter = ref('')
const recentNotifs = ref([])
const reworkBacklog = ref(0)
const myEfficiency = ref(0)

const statusCounts = computed(() => {
  const m = {}
  allTasks.value.forEach(t => { m[t.state] = (m[t.state] || 0) + 1 })
  return { UNASSIGNED: 0, ANNOTATING: 0, VENDOR_QA: 0, CLIENT_QA: 0, ACCEPTED: 0, REJECTED: 0, ...m }
})

const filteredTasks = computed(() => {
  if (!taskFilter.value) return allTasks.value
  return allTasks.value.filter(t => t.state === taskFilter.value)
})

const statCards = computed(() => [
  { key: 'pending', val: statusCounts.value.UNASSIGNED || 0, label: '待接单', color: '#e6a23c' },
  { key: 'active', val: (statusCounts.value.ANNOTATING || 0) + (statusCounts.value.VENDOR_QA || 0), label: '进行中', color: '#409eff' },
  { key: 'rework', val: reworkBacklog.value, label: '返工积压', color: '#f56c6c' },
  { key: 'efficiency', val: myEfficiency.value + '条/h', label: '平均人效', color: '#67c23a' }
])

async function loadTasks() {
  try {
    const res = await request('/tasks?page=1&pageSize=200')
    allTasks.value = res.data || []
  } catch { allTasks.value = [] }
}

async function loadNotifs() {
  try {
    const res = await fetchNotifications({ page: 1, pageSize: 5, type: '' })
    recentNotifs.value = res.data || []
    userStore.unReadMsg = res.meta?.unread || 0
  } catch {}
}

async function loadDashboard() {
  try {
    const res = await request('/dashboard')
    reworkBacklog.value = res.data?.reworkBacklog || 0
    const team = res.data?.teamPerf || []
    const totalPH = team.reduce((a, t) => a + t.perHour, 0)
    myEfficiency.value = team.length ? Number((totalPH / team.length).toFixed(1)) : 0
  } catch {}
}

async function onAccept(task) {
  try {
    await acceptTaskApi(task.id)
    ElMessage.success(`已接单：${task.taskName}`)
    loadTasks()
  } catch {}
}

onMounted(() => { loadTasks(); loadNotifs(); loadDashboard() })
</script>

<style scoped>
.supplier-dash { --gap: 12px; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--gap); margin-bottom: var(--gap); }
.stat-card { text-align: center; }
.stat-num { font-size: 28px; font-weight: bold; }
.stat-label { color: #909399; margin-top: 6px; font-size: 13px; }
.body-row { display: grid; grid-template-columns: 1fr 280px; gap: var(--gap); }
.task-board { min-width: 0; }
.state-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { padding: 4px 12px; border-radius: 14px; background: #f5f7fa; font-size: 12px; cursor: pointer; border: 1px solid transparent; user-select: none; }
.chip.active { background: #409eff; color: #fff; }
.chip-warning.active { background: #e6a23c; }
.chip-primary.active { background: #409eff; }
.chip-success.active { background: #67c23a; }
.chip-danger.active { background: #f56c6c; }
.side-col { display: flex; flex-direction: column; gap: var(--gap); }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.notif-list { display: flex; flex-direction: column; gap: 8px; }
.notif-item { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 4px 0; border-bottom: 1px solid #f5f5f5; cursor: pointer; }
.notif-item.unread .notif-text { font-weight: 600; }
.notif-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notif-time { color: #c0c4cc; font-size: 11px; white-space: nowrap; }
.quick-links { display: flex; flex-direction: column; gap: 8px; }
.quick-links .el-button { width: 100%; }
</style>
