<template>
  <div class="qa-page">
    <div class="qa-toolbar">
      <div class="toolbar-left">
        <el-select v-model="currentTaskId" placeholder="选择任务" style="width:280px" @change="loadQueue">
          <el-option v-for="t in taskOptions" :key="t.id" :label="t.taskName" :value="t.id" />
        </el-select>
        <el-tag :type="level === 'client' ? 'success' : 'warning'" effect="dark">
          {{ level === 'client' ? '甲方质检验收' : '供应商内部质检' }}
        </el-tag>
        <el-tag v-if="task" type="info">单价 ¥{{ task.unitPrice }}/条</el-tag>
      </div>
      <div class="toolbar-right">
        <el-button :disabled="!selectedIds.length" @click="openBatchReject">批量驳回 ({{ selectedIds.length }})</el-button>
      </div>
    </div>

    <div v-if="!currentTaskId" class="empty-tip"><el-empty description="请选择任务进入质检工作台" /></div>

    <div v-else class="qa-body">
      <!-- 左侧待检列表 -->
      <div class="list-panel">
        <div class="panel-title">待检数据（{{ items.length }}）</div>
        <el-checkbox-group v-model="selectedIds">
          <div v-for="it in items" :key="it.id" class="list-item" :class="{ active: currentItem?.id === it.id }" @click="selectItem(it)">
            <el-checkbox :value="it.id" @click.stop></el-checkbox>
            <div class="li-info">
              <div class="li-name">{{ it.itemName }}</div>
              <div class="li-meta">标注人:{{ it.annotator || '-' }} · 框数:{{ (it.annotation?.boxes||[]).length }}</div>
            </div>
            <el-tag v-if="it.isRework" size="small" type="danger">返工</el-tag>
          </div>
        </el-checkbox-group>
        <el-empty v-if="!items.length" description="暂无待检数据" :image-size="60" />
      </div>

      <!-- 中间画布 -->
      <div class="canvas-area">
        <div v-if="!currentItem" class="empty-tip"><el-empty description="请选择数据查看标注" /></div>
        <template v-else>
          <div class="canvas-box" ref="canvasBoxRef">
            <canvas ref="canvasRef" width="640" height="360"></canvas>
            <Watermark :extra="currentItem.itemName" />
          </div>
          <div class="canvas-footer">
            <div class="version-bar" v-if="submissions.length">
              <el-select v-model="comparisonVersion" placeholder="对比历史版本" clearable size="small" style="width:200px" @change="onVersionChange">
                <el-option label="当前版本" :value="null" />
                <el-option v-for="ver in submissions" :key="ver.id" :label="ver.version + ' · ' + ver.submitUser + ' · ' + ver.submitTime" :value="ver.id" />
              </el-select>
            </div>
            <span class="item-name">{{ currentItem.itemName }}</span>
            <el-tag>标注人:{{ currentItem.annotator || '-' }}</el-tag>
            <el-tag type="info">框数:{{ (currentItem.annotation?.boxes||[]).length }}</el-tag>
            <el-tag v-if="currentItem.isRework" type="danger">返工第{{ currentItem.reworkCount }}次</el-tag>
          </div>
          <div v-if="currentItem.isRework && currentItem.rejectNote" class="rework-note">上次驳回：{{ currentItem.rejectNote }}（{{ (currentItem.errorTypes||[]).map(errorLabel).join('/') }}）</div>
        </template>
      </div>

      <!-- 右侧质检操作 -->
      <div class="review-panel">
        <div class="panel-title">质检结论</div>
        <template v-if="currentItem">
          <div class="review-info">
            <div>数据：{{ currentItem.itemName }}</div>
            <div>提交次数：{{ currentItem.submitCount }}</div>
          </div>
          <el-button type="success" :icon="Check" style="width:100%;margin-bottom:12px" @click="onPass">通过 · 进入下一环节</el-button>
          <el-divider>驳回（极速返工流）</el-divider>
          <div class="err-title">错误分类（必选，PRD 3.2）</div>
          <el-checkbox-group v-model="rejectForm.errorTypes" class="err-group">
            <el-checkbox v-for="t in errorTypes" :key="t.value" :value="t.value" :label="t.label" />
          </el-checkbox-group>
          <div class="err-title">驳回批注（必填）</div>
          <el-input v-model="rejectForm.note" type="textarea" :rows="4" placeholder="请说明具体错误位置与修改建议，便于标注员分钟级响应" />
          <el-button type="danger" :icon="Close" style="width:100%;margin-top:12px" @click="onReject">驳回 · 触发返工</el-button>
        </template>
        <el-empty v-else description="选择数据后进行质检" :image-size="60" />
      </div>
    </div>

    <!-- 批量驳回弹窗 -->
    <el-dialog v-model="batchVisible" title="批量驳回" width="460px">
      <div style="margin-bottom:8px">将对 {{ selectedIds.length }} 条数据执行驳回</div>
      <div class="err-title">错误分类</div>
      <el-checkbox-group v-model="batchForm.errorTypes" class="err-group">
        <el-checkbox v-for="t in errorTypes" :key="t.value" :value="t.value" :label="t.label" />
      </el-checkbox-group>
      <div class="err-title">驳回批注</div>
      <el-input v-model="batchForm.note" type="textarea" :rows="3" />
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmBatchReject">确认批量驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Close } from '@element-plus/icons-vue'
import { request } from '@/api/client.js'
import { getWorkbenchQueue, vendorQaItem, clientQaItem, batchVendorQa, batchClientQa } from '@/api/workbench.js'
import { useUserStore } from '@/store/user'
import Watermark from '@/components/Watermark.vue'
import { REJECT_ERROR_TYPES } from '@/utils/constants.js'

const userStore = useUserStore()
const level = computed(() => userStore.userInfo.roleType === 2 ? 'client' : 'vendor')
const canvasRef = ref(null)
const canvasBoxRef = ref(null)

const taskOptions = ref([])
const currentTaskId = ref(null)
const task = ref(null)
const items = ref([])
const submissions = ref([])
const currentItem = ref(null)
const comparisonVersion = ref(null)
const comparisonBoxes = ref([])
const selectedIds = ref([])
let imgEl = null

const errorTypes = REJECT_ERROR_TYPES
const errorLabelMap = {}
REJECT_ERROR_TYPES.forEach(t => { errorLabelMap[t.value] = t.label })
const errorLabel = v => errorLabelMap[v] || v

const rejectForm = reactive({ errorTypes: [], note: '' })
const batchForm = reactive({ errorTypes: [], note: '' })
const batchVisible = ref(false)

async function loadTaskOptions() {
  const res = await request('/tasks?page=1&pageSize=100')
  taskOptions.value = res.data || []
  if (taskOptions.value.length) {
    currentTaskId.value = taskOptions.value[0].id
    await loadQueue()
  }
}

async function loadQueue() {
  if (!currentTaskId.value) return
  const res = await getWorkbenchQueue(currentTaskId.value)
  task.value = res.data.task
  items.value = res.data.items
  submissions.value = res.data.submissions || []
  selectedIds.value = []
  currentItem.value = null
  if (items.value.length) selectItem(items.value[0])
}

function selectItem(it) {
  currentItem.value = it
  comparisonVersion.value = null
  comparisonBoxes.value = []
  rejectForm.errorTypes = []
  rejectForm.note = ''
  nextTick(() => loadImageAndRender())
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

  const colors = ['#ff4d4f', '#52c41a', '#1890ff', '#faad14', '#722ed1', '#13c2c2']

  // 对比版标注（半透明红色虚线，PRD 4.2 对齐对比模式）
  comparisonBoxes.value.forEach((b, i) => {
    ctx.strokeStyle = '#ff4d4f'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 4])
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,77,79,0.7)'
    ctx.font = '13px sans-serif'
    const lw = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), lw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })

  // 当前版标注
  const boxes = currentItem.value?.annotation?.boxes || []
  boxes.forEach((b, i) => {
    const c = colors[i % colors.length]
    ctx.strokeStyle = c
    ctx.lineWidth = 2
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = c
    ctx.font = '13px sans-serif'
    const lw = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), lw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })
}

function onVersionChange(versionId) {
  if (!versionId) { comparisonBoxes.value = []; render(); return }
  const ver = submissions.value.find(s => s.id === versionId)
  if (!ver || !currentItem.value) return
  const snap = ver.itemsSnapshot?.find(s => s.itemId === currentItem.value.id)
  comparisonBoxes.value = snap?.boxes || []
  render()
}

async function onPass() {
  if (!currentItem.value) return
  try {
    const fn = level.value === 'client' ? clientQaItem : vendorQaItem
    await fn(currentItem.value.id, { pass: true })
    ElMessage.success('质检通过')
    await loadQueue()
  } catch (e) {}
}

async function onReject() {
  if (!currentItem.value) return
  if (!rejectForm.errorTypes.length) { ElMessage.warning('请勾选错误分类'); return }
  if (rejectForm.note.trim().length < 2) { ElMessage.warning('请填写驳回批注'); return }
  try {
    const fn = level.value === 'client' ? clientQaItem : vendorQaItem
    await fn(currentItem.value.id, { pass: false, errorTypes: rejectForm.errorTypes, note: rejectForm.note })
    ElMessage.success('已驳回，数据进入返工队列（IS_REWORK）')
    await loadQueue()
  } catch (e) {}
}

function openBatchReject() {
  batchForm.errorTypes = []
  batchForm.note = ''
  batchVisible.value = true
}

async function confirmBatchReject() {
  if (!batchForm.errorTypes.length) { ElMessage.warning('请勾选错误分类'); return }
  if (batchForm.note.trim().length < 2) { ElMessage.warning('请填写驳回批注'); return }
  try {
    const fn = level.value === 'client' ? batchClientQa : batchVendorQa
    const res = await fn({ itemIds: selectedIds.value, pass: false, errorTypes: batchForm.errorTypes, note: batchForm.note })
    ElMessage.success(`批量驳回完成：成功 ${res.data.done} 条`)
    batchVisible.value = false
    await loadQueue()
  } catch (e) {}
}

onMounted(() => { loadTaskOptions() })
</script>

<style scoped>
.qa-page { display: flex; flex-direction: column; height: calc(100vh - 100px); }
.qa-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 10px; }
.qa-body { flex: 1; display: grid; grid-template-columns: 280px 1fr 300px; gap: 12px; min-height: 0; }
.list-panel, .review-panel, .canvas-area { background: #fff; border-radius: 6px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); overflow-y: auto; }
.panel-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; border-left: 3px solid #409eff; padding-left: 8px; }
.list-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 4px; cursor: pointer; border: 1px solid #ebeef5; margin-bottom: 6px; }
.list-item:hover { background: #f5f7fa; }
.list-item.active { background: #ecf5ff; border-color: #409eff; }
.li-info { flex: 1; }
.li-name { font-size: 13px; }
.li-meta { font-size: 11px; color: #909399; margin-top: 2px; }
.canvas-area { display: flex; flex-direction: column; }
.canvas-box { position: relative; display: flex; justify-content: center; background: #1f1f1f; border-radius: 4px; }
.canvas-box canvas { display: block; width: 100%; max-width: 640px; height: auto; }
.canvas-footer { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.item-name { font-weight: bold; }
.rework-note { margin-top: 8px; color: #f56c6c; font-size: 13px; background: #fef0f0; padding: 8px 10px; border-radius: 4px; }
.review-info { font-size: 13px; color: #606266; margin-bottom: 12px; line-height: 1.8; background: #f5f7fa; padding: 10px; border-radius: 4px; }
.err-title { font-size: 13px; font-weight: bold; margin: 10px 0 6px; }
.err-group { display: flex; flex-wrap: wrap; gap: 4px; }
.err-group :deep(.el-checkbox) { margin-right: 12px; }
.empty-tip { display: flex; align-items: center; justify-content: center; flex: 1; }
.version-bar { margin-bottom: 8px; }
.version-bar .el-select { --el-component-size: 28px; }
</style>
