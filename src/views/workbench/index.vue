<template>
  <div class="workbench-page">
    <!-- 顶部工具栏 -->
    <div class="wb-toolbar">
      <div class="toolbar-left">
        <el-select v-model="currentTaskId" placeholder="选择任务" style="width:280px" @change="loadQueue">
          <el-option v-for="t in taskOptions" :key="t.id" :label="t.taskName" :value="t.id" />
        </el-select>
        <el-tag v-if="task" type="info">{{ task.annotateType }} · {{ task.supplierName }}</el-tag>
      </div>
      <div class="toolbar-right">
        <el-tag :type="timingActive ? 'success' : 'warning'" effect="dark">
          {{ timingActive ? '计时中' : '已暂停(无操作)' }} · {{ formatTime(currentItemWorkSeconds) }}
        </el-tag>
        <el-button :icon="Check" type="primary" :disabled="!currentItem" @click="onSubmit">提交本条</el-button>
      </div>
    </div>

    <div v-if="!currentTaskId" class="empty-tip">
      <el-empty description="请选择一个任务开始标注作业" />
    </div>

    <div v-else class="wb-body">
      <!-- 左侧 SOP 规范侧栏（PRD 4.1 悬浮展示） -->
      <div class="sop-panel">
        <div class="sop-title">作业 SOP 规范</div>
        <div class="sop-content" v-html="task?.qaStandard || '<p>暂无规范</p>'"></div>
        <div class="sop-title" style="margin-top:12px">标签字典</div>
        <div class="label-list">
          <el-tag v-for="lb in (task?.labels || [])" :key="lb" :type="currentLabel === lb ? 'primary' : 'info'" @click="currentLabel = lb" style="cursor:pointer;margin:2px">{{ lb }}</el-tag>
        </div>
      </div>

      <!-- 中间画布区 -->
      <div class="canvas-area" ref="canvasAreaRef">
        <div v-if="!currentItem" class="empty-tip"><el-empty description="请从右侧队列选择数据" /></div>
        <template v-else>
          <div class="canvas-box" ref="canvasBoxRef">
            <canvas ref="canvasRef" width="640" height="360" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp"></canvas>
            <Watermark :extra="currentItem.itemName" />
          </div>
          <div class="canvas-footer">
            <span class="item-name">{{ currentItem.itemName }}</span>
            <el-tag v-if="currentItem.isRework" type="danger" effect="dark">返工 · {{ (currentItem.errorTypes||[]).map(errorLabel).join('/') }}</el-tag>
            <el-tag :type="statusType(currentItem.status)">{{ statusText(currentItem.status) }}</el-tag>
            <div v-if="currentItem.isRework && currentItem.rejectNote" class="rework-note">驳回批注：{{ currentItem.rejectNote }}</div>
          </div>
          <!-- 返工历史 -->
          <el-collapse v-if="currentItem.history && currentItem.history.length" class="history-collapse">
            <el-collapse-item title="操作历史 / 驳回记录">
              <el-timeline>
                <el-timeline-item v-for="(h, i) in currentItem.history" :key="i" :type="h.action.includes('reject') ? 'danger' : 'primary'" :timestamp="h.time">
                  {{ h.actor }} · {{ actionText(h.action) }}<span v-if="h.note">：{{ h.note }}</span>
                </el-timeline-item>
              </el-timeline>
            </el-collapse-item>
          </el-collapse>
        </template>
      </div>

      <!-- 右侧队列 + 框列表 -->
      <div class="queue-panel">
        <div class="queue-title">
          作业队列（{{ items.length }}）
          <el-badge v-if="reworkCount" :value="reworkCount + '返工'" type="danger" />
        </div>
        <div class="queue-list">
          <div v-for="it in items" :key="it.id" class="queue-item" :class="{ active: currentItem?.id === it.id, rework: it.isRework }" @click="selectItem(it)">
            <div class="qi-name">
              <el-icon v-if="it.isRework" color="#f56c6c"><WarnTriangleFilled /></el-icon>
              {{ it.itemName }}
            </div>
            <el-tag size="small" :type="statusType(it.status)">{{ statusText(it.status) }}</el-tag>
          </div>
        </div>

        <template v-if="currentItem">
          <div class="queue-title" style="margin-top:12px">标注框（{{ boxes.length }}）</div>
          <div class="box-list">
            <div v-for="(b, i) in boxes" :key="i" class="box-item">
              <el-select v-model="b.label" size="small" style="width:100px" @change="render">
                <el-option v-for="lb in (task?.labels||[])" :key="lb" :label="lb" :value="lb" />
              </el-select>
              <span class="box-coord">{{ b.x }},{{ b.y }} {{ b.w }}×{{ b.h }}</span>
              <el-button text type="danger" size="small" :icon="Delete" @click="boxes.splice(i,1); render()" />
            </div>
            <div v-if="!boxes.length" class="empty-mini">在画布上拖拽绘制框体</div>
          </div>
          <el-button style="margin-top:8px;width:100%" :icon="Refresh" @click="onSaveDraft">保存暂存</el-button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Delete, Refresh, WarnTriangleFilled } from '@element-plus/icons-vue'
import { request } from '@/api/client.js'
import { getWorkbenchQueue, claimItem, saveAnnotation, submitItem } from '@/api/workbench.js'
import { heartbeat } from '@/api/timing.js'
import { useUserStore } from '@/store/user'
import Watermark from '@/components/Watermark.vue'
import { REJECT_ERROR_TYPES } from '@/utils/constants.js'

const userStore = useUserStore()
const route = useRoute()
const canvasAreaRef = ref(null)
const canvasBoxRef = ref(null)
const canvasRef = ref(null)

const taskOptions = ref([])
const currentTaskId = ref(null)
const task = ref(null)
const items = ref([])
const currentItem = ref(null)
const boxes = reactive([])
const currentLabel = ref('车辆')

// 防挂机计时引擎（PRD 4.4）
const timingActive = ref(false)
const currentItemWorkSeconds = ref(0)
let lastActivity = Date.now()
let activeAccumulator = 0
let heartbeatTimer = null
let activityTimer = null
let imgEl = null

const errorLabelMap = {}
REJECT_ERROR_TYPES.forEach(t => { errorLabelMap[t.value] = t.label })
const errorLabel = v => errorLabelMap[v] || v

const STATUS_TEXT = { pending: '待标注', annotating: '标注中', annotated: '待供应商质检', vendor_passed: '待甲方质检', accepted: '已验收', rework: '返工中' }
const STATUS_TYPE = { pending: 'info', annotating: 'warning', annotated: '', vendor_passed: '', accepted: 'success', rework: 'danger' }
const statusText = s => STATUS_TEXT[s] || s
const statusType = s => STATUS_TYPE[s] || 'info'
const actionText = a => ({ claim: '领取', submit: '提交', rework_submit: '返工提交', vendor_pass: '供应商通过', vendor_reject: '供应商驳回', client_pass: '甲方通过', client_reject: '甲方驳回' }[a] || a)

const reworkCount = ref(0)

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function loadTaskOptions() {
  const res = await request('/tasks?page=1&pageSize=100')
  taskOptions.value = (res.data || []).filter(t => ['ANNOTATING', 'VENDOR_QA'].includes(t.state))
  // 优先使用路由传入的 taskId，否则取第一个
  const routeTaskId = route.params.taskId ? Number(route.params.taskId) : null
  const matched = routeTaskId && taskOptions.value.find(t => t.id === routeTaskId)
  const targetId = matched ? routeTaskId : (taskOptions.value.length ? taskOptions.value[0].id : null)
  if (targetId && !currentTaskId.value) {
    currentTaskId.value = targetId
    await loadQueue()
  }
}

async function loadQueue() {
  if (!currentTaskId.value) return
  const res = await getWorkbenchQueue(currentTaskId.value)
  task.value = res.data.task
  items.value = res.data.items
  reworkCount.value = items.value.filter(i => i.isRework).length
  if (task.value?.labels?.length) currentLabel.value = task.value.labels[0]
  // 默认选中第一条返工或自己领取中的数据
  const mine = items.value.find(i => i.isRework) || items.value.find(i => i.status === 'annotating') || items.value[0]
  if (mine) selectItem(mine)
  else currentItem.value = null
}

async function selectItem(it) {
  // 停止上一个的计时
  stopTiming()
  // 待标注需先领取
  if (it.status === 'pending') {
    try {
      await claimItem(it.id)
      ElMessage.success('已领取：' + it.itemName)
    } catch (e) { return }
  }
  currentItem.value = it
  boxes.splice(0, boxes.length)
  currentItemWorkSeconds.value = it.workSeconds || 0
  // 优先恢复本地暂存
  const local = localStorage.getItem(`wb_${it.id}`)
  if (local) {
    try {
      const parsed = JSON.parse(local)
      if (Array.isArray(parsed.boxes) && parsed.boxes.length) {
        boxes.push(...parsed.boxes)
        ElMessage.info('已恢复未提交的本地暂存')
      }
    } catch {}
  } else if (it.annotation?.boxes?.length) {
    boxes.push(...it.annotation.boxes.map(b => ({ ...b })))
  }
  await nextTick()
  loadImageAndRender()
  startTiming()
}

function loadImageAndRender() {
  if (!currentItem.value?.image || !canvasRef.value) return
  imgEl = new Image()
  imgEl.onload = () => render()
  imgEl.src = currentItem.value.image
}

function render() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (imgEl) ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height)
  // 已有框
  const colors = ['#ff4d4f', '#52c41a', '#1890ff', '#faad14', '#722ed1', '#13c2c2']
  boxes.forEach((b, i) => {
    const c = colors[i % colors.length]
    ctx.strokeStyle = c
    ctx.lineWidth = 2
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = c
    ctx.font = '13px sans-serif'
    const labelW = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), labelW, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })
  // 正在绘制的框
  if (drawing.active) {
    ctx.strokeStyle = '#409eff'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.strokeRect(drawing.x, drawing.y, drawing.w, drawing.h)
    ctx.setLineDash([])
  }
}

const drawing = reactive({ active: false, x: 0, y: 0, w: 0, h: 0, startX: 0, startY: 0 })

function getCoord(e) {
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
}

function onMouseDown(e) {
  if (!currentItem.value) return
  const p = getCoord(e)
  drawing.active = true
  drawing.startX = p.x; drawing.startY = p.y
  drawing.x = p.x; drawing.y = p.y; drawing.w = 0; drawing.h = 0
  markActivity()
}
function onMouseMove(e) {
  markActivity()
  if (!drawing.active) return
  const p = getCoord(e)
  drawing.x = Math.min(p.x, drawing.startX)
  drawing.y = Math.min(p.y, drawing.startY)
  drawing.w = Math.abs(p.x - drawing.startX)
  drawing.h = Math.abs(p.y - drawing.startY)
  render()
}
function onMouseUp() {
  if (!drawing.active) return
  drawing.active = false
  if (drawing.w > 5 && drawing.h > 5) {
    boxes.push({ x: Math.round(drawing.x), y: Math.round(drawing.y), w: Math.round(drawing.w), h: Math.round(drawing.h), label: currentLabel.value })
    autoSaveLocal()
    render()
  }
}

function autoSaveLocal() {
  if (!currentItem.value) return
  localStorage.setItem(`wb_${currentItem.value.id}`, JSON.stringify({ boxes, savedAt: Date.now() }))
}

async function onSaveDraft() {
  if (!currentItem.value) return
  try {
    await saveAnnotation(currentItem.value.id, boxes)
    autoSaveLocal()
    ElMessage.success('已暂存 ' + boxes.length + ' 个标注框')
  } catch (e) {}
}

async function onSubmit() {
  if (!currentItem.value) return
  if (!boxes.length) { ElMessage.warning('请先绘制标注框'); return }
  try {
    await ElMessageBox.confirm('提交后将进入供应商质检，确认提交？', '提示', { type: 'warning' })
  } catch { return }
  try {
    await saveAnnotation(currentItem.value.id, boxes)
    await submitItem(currentItem.value.id)
    localStorage.removeItem(`wb_${currentItem.value.id}`)
    ElMessage.success('已提交，进入供应商质检')
    await loadQueue()
  } catch (e) {}
}

// ===== 防挂机计时 =====
function markActivity() { lastActivity = Date.now() }

function startTiming() {
  stopTiming()
  lastActivity = Date.now()
  activeAccumulator = 0
  // 每秒检测活跃状态
  activityTimer = setInterval(() => {
    const idle = Date.now() - lastActivity
    timingActive.value = idle < 180000 // 3分钟无操作暂停
    if (timingActive.value) activeAccumulator += 1
  }, 1000)
  // 每30秒上报一次有效工时
  heartbeatTimer = setInterval(async () => {
    if (!currentItem.value || activeAccumulator <= 0) return
    const send = Math.min(activeAccumulator, 120)
    try {
      const res = await heartbeat(currentItem.value.id, send)
      if (res.data?.total != null) currentItemWorkSeconds.value = res.data.total
    } catch {}
    activeAccumulator = 0
  }, 30000)
}

function stopTiming() {
  if (activityTimer) { clearInterval(activityTimer); activityTimer = null }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  timingActive.value = false
}

onMounted(() => {
  loadTaskOptions()
  window.addEventListener('mousemove', markActivity)
  window.addEventListener('keydown', markActivity)
})
onUnmounted(() => {
  stopTiming()
  window.removeEventListener('mousemove', markActivity)
  window.removeEventListener('keydown', markActivity)
})
</script>

<style scoped>
.workbench-page { display: flex; flex-direction: column; height: calc(100vh - 100px); }
.wb-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 10px; }
.wb-body { flex: 1; display: grid; grid-template-columns: 240px 1fr 280px; gap: 12px; min-height: 0; }
.sop-panel, .queue-panel { background: #fff; border-radius: 6px; padding: 12px; overflow-y: auto; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.sop-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; color: #303133; border-left: 3px solid #409eff; padding-left: 8px; }
.sop-content { font-size: 13px; color: #606266; line-height: 1.8; }
.sop-content :deep(p) { margin: 4px 0; }
.label-list { display: flex; flex-wrap: wrap; }
.canvas-area { display: flex; flex-direction: column; background: #fff; border-radius: 6px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); min-height: 0; }
.canvas-box { position: relative; display: flex; justify-content: center; background: #1f1f1f; border-radius: 4px; }
.canvas-box canvas { display: block; width: 100%; max-width: 640px; height: auto; cursor: crosshair; }
.canvas-footer { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.item-name { font-weight: bold; }
.rework-note { width: 100%; color: #f56c6c; font-size: 13px; background: #fef0f0; padding: 6px 10px; border-radius: 4px; }
.history-collapse { margin-top: 8px; }
.queue-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.queue-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
.queue-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-radius: 4px; cursor: pointer; border: 1px solid #ebeef5; transition: all 0.2s; }
.queue-item:hover { background: #f5f7fa; }
.queue-item.active { background: #ecf5ff; border-color: #409eff; }
.queue-item.rework { border-color: #f56c6c; background: #fef0f0; }
.qi-name { font-size: 13px; display: flex; align-items: center; gap: 4px; }
.box-list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
.box-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.box-coord { color: #909399; flex: 1; }
.empty-mini { color: #c0c4cc; font-size: 12px; text-align: center; padding: 12px; }
.empty-tip { display: flex; align-items: center; justify-content: center; flex: 1; }
</style>
