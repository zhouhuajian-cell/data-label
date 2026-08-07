<template>
  <div class="supplier-dash">
    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <el-card shadow="hover">
      <template #header><span>任务看板</span></template>
      <div class="state-chips">
        <span class="chip" :class="{ active: taskFilter === '' }" @click="taskFilter = ''">全部 <b>{{ allTasks.length }}</b></span>
        <span class="chip chip-warning" :class="{ active: taskFilter === 'UNASSIGNED' }" @click="taskFilter = 'UNASSIGNED'">待接单 <b>{{ statusCounts.UNASSIGNED }}</b></span>
        <span class="chip chip-primary" :class="{ active: taskFilter === 'ANNOTATING' }" @click="taskFilter = 'ANNOTATING'">标注中 <b>{{ statusCounts.ANNOTATING }}</b></span>
        <span class="chip chip-warning" :class="{ active: taskFilter === 'VENDOR_QA' }" @click="taskFilter = 'VENDOR_QA'">待质检 <b>{{ statusCounts.VENDOR_QA }}</b></span>
        <span class="chip chip-primary" :class="{ active: taskFilter === 'CLIENT_QA' }" @click="taskFilter = 'CLIENT_QA'">待验收 <b>{{ statusCounts.CLIENT_QA }}</b></span>
        <span class="chip chip-danger" :class="{ active: taskFilter === 'REJECTED' }" @click="taskFilter = 'REJECTED'">驳回 <b>{{ statusCounts.REJECTED }}</b></span>
        <span class="chip chip-success" :class="{ active: taskFilter === 'ACCEPTED' }" @click="taskFilter = 'ACCEPTED'">已验收 <b>{{ statusCounts.ACCEPTED }}</b></span>
      </div>

      <el-table :data="filteredTasks" border size="small">
        <el-table-column label="任务名称" prop="taskName" min-width="180" show-overflow-tooltip />
        <el-table-column label="类型" prop="annotateType" width="100" />
        <el-table-column label="样本量" prop="sampleCount" width="70" />
        <el-table-column label="状态" width="90"><template #default="s"><el-tag :type="getStateType(s.row.state)" size="small">{{ getStateText(s.row.state) }}</el-tag></template></el-table-column>
        <el-table-column label="截止" prop="deadline" width="130" />
        <el-table-column label="操作" width="240">
          <template #default="s">
            <el-button v-if="s.row.state === 'UNASSIGNED'" size="small" type="primary" @click="onAccept(s.row)">接单</el-button>
            <el-button v-if="s.row.annotateType === '2D拉框' && ['ANNOTATING','REJECTED'].includes(s.row.state)" size="small" type="success" @click="$router.push('/workbench/' + s.row.id)">进入标注</el-button>
            <el-button v-if="s.row.state === 'VENDOR_QA'" size="small" type="primary" @click="openQAPanel(s.row)">内部质检</el-button>
            <el-button v-if="['VENDOR_QA','REJECTED'].includes(s.row.state)" size="small" type="success" @click="$router.push('/task/detail/' + s.row.id)">提交</el-button>
            <el-button size="small" @click="$router.push('/task/detail/' + s.row.id)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!allTasks.length" description="暂无任务" :image-size="80" />
    </el-card>

    <!-- 内嵌质检面板 -->
    <el-card v-if="qaVisible" shadow="hover" style="margin-top:12px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>内部质检 · {{ qaTask?.taskName }}</span>
          <el-button size="small" text @click="qaVisible=false">关闭</el-button>
        </div>
      </template>
      <div class="qa-inline" v-loading="qaLoading">
        <div class="qa-items">
          <div v-for="it in qaItems" :key="it.id" class="qa-item" :class="{active:qaCurrent?.id===it.id}" @click="qaCurrent=it">
            <div class="qi-name">{{ it.itemName }}</div>
            <div class="qi-meta">{{ it.annotator||'-' }} · {{ (it.annotation?.boxes||[]).length }}框</div>
            <el-button size="small" type="success" @click.stop="qaPass(it)">通过</el-button>
            <el-button size="small" type="danger" @click.stop="qaReject(it)">驳回</el-button>
          </div>
          <el-empty v-if="!qaItems.length" :image-size="40" description="暂无待检" />
        </div>
        <div class="qa-canvas" v-if="qaCurrent">
          <canvas ref="qaCanvas" width="640" height="360" />
          <div style="margin-top:6px;font-size:13px">{{ qaCurrent.itemName }}</div>
        </div>
      </div>
    </el-card>

    <!-- 驳回弹窗 -->
    <el-dialog v-model="rejVisible" title="驳回明细" width="460px">
      <div class="err-title">错误分类</div>
      <el-checkbox-group v-model="rejForm.errorTypes" class="err-group">
        <el-checkbox v-for="t in errorTypes" :key="t.value" :value="t.value" :label="t.label" />
      </el-checkbox-group>
      <div class="err-title" style="margin-top:10px">驳回批注</div>
      <el-input v-model="rejForm.note" type="textarea" :rows="3" />
      <template #footer><el-button @click="rejVisible=false">取消</el-button><el-button type="danger" @click="confirmReject">确认驳回</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import { acceptTaskApi, getTaskListApi } from '@/api/tasks.js'
import { getWorkbenchQueue, vendorQaItem } from '@/api/workbench.js'
import { getTaskStateText, getTaskStateType, REJECT_ERROR_TYPES } from '@/utils/constants.js'

const userStore = useUserStore()
const errorTypes = REJECT_ERROR_TYPES
const allTasks = ref([])
const taskFilter = ref('')
const reworkBacklog = ref(0)

const qaVisible = ref(false), qaTask = ref(null), qaItems = ref([]), qaCurrent = ref(null), qaLoading = ref(false), qaCanvas = ref(null)
const rejVisible = ref(false), rejForm = reactive({ errorTypes: [], note: '' }), rejItem = ref(null)
let imgEl = null

const getStateText = getTaskStateText, getStateType = getTaskStateType

const statusCounts = computed(() => {
  const m = {}; allTasks.value.forEach(t => { m[t.state] = (m[t.state] || 0) + 1 })
  return { UNASSIGNED: 0, ANNOTATING: 0, VENDOR_QA: 0, CLIENT_QA: 0, ACCEPTED: 0, REJECTED: 0, ...m }
})

const filteredTasks = computed(() => taskFilter.value ? allTasks.value.filter(t => t.state === taskFilter.value) : allTasks.value)

const statCards = computed(() => [
  { key: 'pending', val: statusCounts.value.UNASSIGNED || 0, label: '待接单', color: '#e6a23c' },
  { key: 'active', val: (statusCounts.value.ANNOTATING || 0) + (statusCounts.value.VENDOR_QA || 0), label: '进行中', color: '#409eff' },
  { key: 'rework', val: reworkBacklog.value, label: '返工积压', color: '#f56c6c' },
  { key: 'done', val: statusCounts.value.ACCEPTED || 0, label: '已验收', color: '#67c23a' }
])

async function loadTasks() {
  try { const res = await getTaskListApi({ pageSize: 200 }); allTasks.value = res.data || []; reworkBacklog.value = allTasks.value.filter(t => t.state === 'REJECTED').length } catch {}
}

async function onAccept(task) { try { await acceptTaskApi(task.id); ElMessage.success('已接单'); loadTasks() } catch {} }

// 内嵌质检
async function openQAPanel(task) {
  qaTask.value = task; qaVisible.value = true; qaItems.value = []; qaCurrent.value = null
  qaLoading.value = true
  try {
    const res = await getWorkbenchQueue(task.id)
    qaItems.value = res.data.items || []
    if (qaItems.value.length) { qaCurrent.value = qaItems.value[0]; await nextTick(); loadQaImage() }
  } catch {} finally { qaLoading.value = false }
}

function loadQaImage() {
  if (!qaCurrent.value?.image || !qaCanvas.value) return
  imgEl = new Image(); imgEl.onload = renderQa; imgEl.src = qaCurrent.value.image
}

function renderQa() {
  const c = qaCanvas.value; if (!c) return
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height)
  if (imgEl) ctx.drawImage(imgEl, 0, 0, c.width, c.height)
  const colors = ['#ff4d4f','#52c41a','#1890ff','#faad14','#722ed1']
  ;(qaCurrent.value?.annotation?.boxes || []).forEach((b, i) => {
    const co = colors[i % 5]; ctx.strokeStyle = co; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = co; ctx.font = '13px sans-serif'; const lw = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), lw, 18); ctx.fillStyle = '#fff'; ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })
}

async function qaPass(it) { try { await vendorQaItem(it.id, { pass: true }); ElMessage.success('已通过'); openQAPanel(qaTask.value) } catch {} }
function qaReject(it) { rejItem.value = it; rejForm.errorTypes = []; rejForm.note = ''; rejVisible.value = true }

async function confirmReject() {
  if (!rejForm.errorTypes.length) { ElMessage.warning('请勾选错误分类'); return }
  if (rejForm.note.trim().length < 2) { ElMessage.warning('请填写批注'); return }
  try { await vendorQaItem(rejItem.value.id, { pass: false, errorTypes: rejForm.errorTypes, note: rejForm.note }); rejVisible.value = false; openQAPanel(qaTask.value); ElMessage.success('已驳回') } catch {}
}

onMounted(() => { loadTasks(); window.addEventListener('focus', loadTasks); window.addEventListener('visibilitychange', () => { if (!document.hidden) loadTasks() }) })
</script>

<style scoped>
.supplier-dash{--gap:12px}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--gap);margin-bottom:var(--gap)}
.stat-card{text-align:center}.stat-num{font-size:28px;font-weight:bold}.stat-label{color:#909399;margin-top:6px;font-size:13px}
.state-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.chip{padding:4px 12px;border-radius:14px;background:#f5f7fa;font-size:12px;cursor:pointer;border:1px solid transparent;user-select:none}
.chip.active{background:#409eff;color:#fff}.chip-warning.active{background:#e6a23c}.chip-primary.active{background:#409eff}.chip-success.active{background:#67c23a}.chip-danger.active{background:#f56c6c}
.qa-inline{display:grid;grid-template-columns:1fr 340px;gap:12px}
.qa-items{display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto}
.qa-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #ebeef5;border-radius:4px;cursor:pointer;font-size:13px}
.qa-item:hover{background:#f5f7fa}.qa-item.active{background:#ecf5ff;border-color:#409eff}
.qi-name{flex:1;font-weight:500}.qi-meta{font-size:11px;color:#909399;margin-top:2px}
.qa-canvas canvas{display:block;width:100%;max-width:640px;height:auto;background:#1f1f1f;border-radius:4px}
.err-title{font-size:13px;font-weight:bold;margin-bottom:4px}.err-group{display:flex;flex-wrap:wrap;gap:4px}
</style>
