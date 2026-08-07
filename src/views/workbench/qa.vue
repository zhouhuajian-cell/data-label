<template>
  <div class="qa-page">
    <div class="qa-toolbar">
      <el-tag :type="level === 'client' ? 'success' : 'warning'" effect="dark">{{ level === 'client' ? '甲方验收' : '供应商内审' }}</el-tag>
      <span v-if="level==='client'" style="color:#606266">待验收：{{ taskList.length }} 任务</span>
      <span v-else-if="currentTask" style="color:#606266">{{ currentTask.taskName }}</span>
      <el-button v-if="level==='client' && currentTaskId" size="small" @click="downloadTaskFile">下载数据包</el-button>
      <template v-if="level==='vendor' && currentTaskId">
        <el-button v-if="!currentTask?.qaClaimedBy" size="small" type="primary" @click="onClaimQa">领取质检</el-button>
        <el-button v-else-if="currentTask?.qaClaimedByName" size="small" type="warning" @click="onReleaseQa">释放质检</el-button>
        <el-tag v-if="currentTask?.qaClaimedByName" size="small" type="warning">已由 {{ currentTask.qaClaimedByName }} 领取</el-tag>
      </template>
    </div>

    <div class="qa-body">
      <!-- 左侧任务列表 -->
      <div class="task-list-panel">
        <div class="panel-title">任务列表</div>
        <div v-if="level==='client'">
          <div v-for="t in taskList" :key="t.id" class="task-item" :class="{active:currentTaskId===t.id}" @click="selectTask(t)">
            <div class="ti-name">{{ t.taskName }}</div>
            <div class="ti-meta">{{ t.supplierName||'-' }} · {{ t.sampleCount }}条</div>
          </div>
          <el-empty v-if="!taskList.length" description="暂无" :image-size="50" />
        </div>
        <el-select v-else v-model="currentTaskId" placeholder="选择任务" style="width:100%" @change="loadQueue">
          <el-option v-for="t in taskOptions" :key="t.id" :label="t.taskName" :value="t.id" />
        </el-select>
      </div>

      <!-- 右侧：画布 + 明细列表(带操作按钮) -->
      <div class="main-area">
        <template v-if="currentTaskId">
          <div class="canvas-box" v-if="currentItem"><canvas ref="canvasRef" width="640" height="360" /></div>
          <div class="item-list">
            <div v-for="it in items" :key="it.id" class="i-row" :class="{cur:currentItem?.id===it.id}" @click="selectItem(it)">
              <div class="i-info">
                <div class="i-name">{{ it.itemName }}</div>
                <div class="i-meta">{{ it.annotator||'-' }} · {{ (it.annotation?.boxes||[]).length }}框<span v-if="it.isRework" style="color:#f56c6c"> · 返工</span></div>
              </div>
              <el-button size="small" type="success" @click.stop="quickPass(it)">通过</el-button>
              <el-button size="small" type="danger" @click.stop="openRejectDlg(it)">驳回</el-button>
            </div>
            <el-empty v-if="!items.length" :image-size="50" description="暂无待检数据" />
          </div>
        </template>
        <el-empty v-else :image-size="80" description="选择左侧任务" />
      </div>
    </div>

    <!-- 驳回弹窗 -->
    <el-dialog v-model="rejectVisible" title="驳回明细" width="460px">
      <div style="margin-bottom:6px;font-weight:600">{{ rejectItem?.itemName }}</div>
      <div class="err-title">错误分类（必选）</div>
      <el-checkbox-group v-model="rejectForm.errorTypes" class="err-group">
        <el-checkbox v-for="t in errorTypes" :key="t.value" :value="t.value" :label="t.label" />
      </el-checkbox-group>
      <div class="err-title" style="margin-top:10px">驳回批注（必填）</div>
      <el-input v-model="rejectForm.note" type="textarea" :rows="3" placeholder="标注员可据此修改" />
      <template #footer>
        <el-button @click="rejectVisible=false">取消</el-button>
        <el-button type="danger" @click="confirmReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { getWorkbenchQueue, vendorQaItem, clientQaItem, claimQaTask, releaseQaTask } from '@/api/workbench.js'
import { getTaskListApi, getTaskDetailApi, reviewTaskApi } from '@/api/tasks.js'
import { useUserStore } from '@/store/user'
import { REJECT_ERROR_TYPES } from '@/utils/constants.js'
import { useDownload } from '@/composables/useDownload'

const userStore = useUserStore()
const { downloadFile: downloadBlob } = useDownload()
const level = computed(() => userStore.userInfo.roleType === 2 ? 'client' : 'vendor')
const canvasRef = ref(null)
const taskList = ref([])
const taskOptions = ref([])
const currentTaskId = ref(null)
const currentTask = ref(null)
const items = ref([])
const currentItem = ref(null)
let imgEl = null

const errorTypes = REJECT_ERROR_TYPES
const rejectVisible = ref(false)
const rejectItem = ref(null)
const rejectForm = reactive({ errorTypes: [], note: '' })

async function loadTasks() {
  if (level.value === 'client') {
    try {
      const res = await getTaskListApi({ pageSize: 200 })
      taskList.value = (res.data || []).filter(t => t.state === 'CLIENT_QA')
      if (taskList.value.length && !currentTaskId.value) await selectTask(taskList.value[0])
    } catch {}
  } else {
    try { const res = await getTaskListApi({ pageSize: 200 }); taskOptions.value = res.data || [] } catch {}
  }
}

async function selectTask(t) { currentTaskId.value = t.id; currentItem.value = null; await loadQueue() }

async function loadQueue() {
  if (!currentTaskId.value) return
  try {
    const res = await getWorkbenchQueue(currentTaskId.value)
    currentTask.value = res.data.task || null
    items.value = res.data.items || []
    currentItem.value = items.value[0] || null
    if (currentItem.value) nextTick(loadImg)
  } catch {}
}

async function onClaimQa() {
  try {
    await claimQaTask(currentTaskId.value)
    ElMessage.success('已领取质检任务')
    loadQueue()
  } catch {}
}

async function onReleaseQa() {
  try {
    await releaseQaTask(currentTaskId.value)
    ElMessage.success('已释放质检任务')
    loadQueue()
  } catch {}
}

function selectItem(it) { currentItem.value = it; nextTick(loadImg) }

function loadImg() {
  if (!currentItem.value?.image || !canvasRef.value) return
  imgEl = new Image(); imgEl.onload = render; imgEl.src = currentItem.value.image
}

function render() {
  const c = canvasRef.value; if (!c) return
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height)
  if (imgEl) ctx.drawImage(imgEl, 0, 0, c.width, c.height)
  const boxes = currentItem.value?.annotation?.boxes || []
  const colors = ['#ff4d4f','#52c41a','#1890ff','#faad14','#722ed1','#13c2c2']
  boxes.forEach((b, i) => {
    const co = colors[i % colors.length]
    ctx.strokeStyle = co; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = co; ctx.font = '13px sans-serif'
    const lw = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), lw, 18)
    ctx.fillStyle = '#fff'; ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })
}

async function quickPass(it) {
  if (level.value === 'vendor' && currentTask.value?.qaClaimedBy && currentTask.value.qaClaimedBy !== userStore.userInfo.id) { ElMessage.warning('该质检任务已被他人领取'); return }
  try {
    const fn = level.value === 'client' ? clientQaItem : vendorQaItem
    await fn(it.id, { pass: true })
    // 甲方验收：同时调用任务级验收，双保险确保状态流转
    if (level.value === 'client') {
      try {
        await reviewTaskApi(currentTaskId.value, { pass: true, score: 100, comment: '质检通过' })
      } catch {}
    }
    ElMessage.success('已通过')
    loadQueue(); loadTasks()
  } catch {}
}

function openRejectDlg(it) {
  if (level.value === 'vendor' && currentTask.value?.qaClaimedBy && currentTask.value.qaClaimedBy !== userStore.userInfo.id) { ElMessage.warning('该质检任务已被他人领取'); return }
  rejectItem.value = it; rejectForm.errorTypes = []; rejectForm.note = ''; rejectVisible.value = true
}

async function confirmReject() {
  if (!rejectForm.errorTypes.length) { ElMessage.warning('请勾选错误分类'); return }
  if (rejectForm.note.trim().length < 2) { ElMessage.warning('请填写驳回批注'); return }
  try {
    const fn = level.value === 'client' ? clientQaItem : vendorQaItem
    await fn(rejectItem.value.id, { pass: false, errorTypes: rejectForm.errorTypes, note: rejectForm.note })
    ElMessage.success('已驳回')
    rejectVisible.value = false; loadQueue()
  } catch {}
}

async function downloadTaskFile() {
  if (!currentTaskId.value) return
  try {
    const { data } = await getTaskDetailApi(currentTaskId.value)
    const v = data?.versions || []; const latest = v[v.length - 1]
    if (!latest?.storedName) { ElMessage.warning('未提交成果文件'); return }
    await downloadBlob('/submissions/' + latest.id + '/download', latest.fileName || 's_' + latest.id)
  } catch { ElMessage.error('下载失败') }
}

onMounted(loadTasks)
</script>

<style scoped>
.qa-page { display: flex; flex-direction: column; height: calc(100vh - 100px); }
.qa-toolbar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #fff; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.qa-body { flex: 1; display: grid; grid-template-columns: 220px 1fr; gap: 12px; min-height: 0; }
.task-list-panel, .main-area { background: #fff; border-radius: 6px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); overflow-y: auto; }
.panel-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; border-left: 3px solid #409eff; padding-left: 8px; }
.task-item { padding: 8px 10px; border: 1px solid #ebeef5; border-radius: 4px; cursor: pointer; margin-bottom: 6px; }
.task-item:hover { background: #f5f7fa; } .task-item.active { background: #ecf5ff; border-color: #409eff; }
.ti-name { font-size: 13px; font-weight: 600; } .ti-meta { font-size: 11px; color: #909399; margin-top: 2px; }
.canvas-box { background: #1f1f1f; border-radius: 4px; display: flex; justify-content: center; margin-bottom: 10px; }
.canvas-box canvas { display: block; width: 100%; max-width: 640px; height: auto; }
.canvas-footer { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.item-list { display: flex; flex-direction: column; gap: 6px; }
.i-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #ebeef5; border-radius: 4px; cursor: pointer; transition: all .2s; }
.i-row:hover { background: #f5f7fa; } .i-row.cur { background: #ecf5ff; border-color: #409eff; }
.i-info { flex: 1; min-width: 0; } .i-name { font-size: 13px; font-weight: 500; } .i-meta { font-size: 11px; color: #909399; margin-top: 2px; }
.err-title { font-size: 13px; font-weight: bold; margin-bottom: 4px; } .err-group { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
