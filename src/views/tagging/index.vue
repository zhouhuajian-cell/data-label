<template>
  <div class="tagging-page">
    <div class="tg-toolbar">
      <div class="toolbar-left">
        <el-select v-model="currentTaskId" placeholder="选择任务" style="width:280px" @change="loadQueue">
          <el-option v-for="t in taskOptions" :key="t.id" :label="t.taskName" :value="t.id" />
        </el-select>
        <el-progress v-if="progress.total" :percentage="Math.round(progress.tagged/progress.total*100)" :stroke-width="8" style="width:200px" />
        <span class="progress-text" v-if="progress.total">{{ progress.tagged }}/{{ progress.total }} 已打标签</span>
      </div>
      <div class="toolbar-right">
        <el-button v-if="selectedIds.length" size="small" type="warning" @click="openBatch">批量打标签 ({{ selectedIds.length }})</el-button>
        <el-button v-if="userStore.isAdmin" size="small" :icon="Setting" @click="openDimEditor">维度管理</el-button>
      </div>
    </div>

    <div v-if="!currentTaskId" class="empty-tip"><el-empty description="选择任务进入数据清洗" /></div>

    <div v-else class="tg-body">
      <!-- 左侧明细列表 -->
      <div class="item-list-panel">
        <el-checkbox-group v-model="selectedIds">
          <div v-for="it in items" :key="it.id" class="il-item" :class="{ active: currentItem?.id === it.id }" @click="selectItem(it)">
            <el-checkbox :value="it.id" class="il-check" @click.stop />
            <div class="il-info">
              <div class="il-name">{{ it.itemName }}</div>
              <div class="il-tags">
                <el-tag v-for="t in (it.tags||[])" :key="t" size="small" effect="plain" type="success" style="margin:1px">{{ t }}</el-tag>
                <span v-if="!(it.tags||[]).length" style="color:#c0c4cc;font-size:11px">未打标签</span>
              </div>
            </div>
          </div>
        </el-checkbox-group>
      </div>

      <!-- 中间画布 -->
      <div class="canvas-area">
        <div v-if="!currentItem" class="empty-tip"><el-empty description="选择数据查看" :image-size="60" /></div>
        <template v-else>
          <div class="canvas-box"><canvas ref="canvasRef" width="640" height="360"></canvas></div>
          <div class="canvas-name">{{ currentItem.itemName }}</div>
        </template>
      </div>

      <!-- 右侧标签编辑 -->
      <div class="tag-panel">
        <div class="panel-title">{{ currentItem ? '场景标签' : '选择数据编辑标签' }}</div>
        <div v-if="currentItem" class="dim-list">
          <div v-for="dim in dimensions" :key="dim.id" class="dim-group">
            <div class="dim-label">{{ dim.label }}</div>
            <div class="dim-tags">
              <el-checkbox-button v-for="t in dim.tags" :key="t" :model-value="editTags.includes(t)" size="small"
                :style="{ margin: '2px' }" @change="() => toggleTag(t)" />
            </div>
          </div>
          <el-button type="primary" :icon="Check" style="width:100%;margin-top:12px" @click="saveCurrent">保存标签</el-button>
        </div>
        <el-empty v-else description="选择数据" :image-size="50" />
      </div>
    </div>

    <!-- 批量打标签 -->
    <el-dialog v-model="batchVisible" title="批量打标签" width="500px">
      <div class="dim-list">
        <div v-for="dim in dimensions" :key="dim.id" class="dim-group">
          <div class="dim-label">{{ dim.label }}</div>
          <div class="dim-tags">
            <el-checkbox-button v-for="t in dim.tags" :key="t" :model-value="batchTags.includes(t)" size="small"
              :style="{ margin: '2px' }" @change="() => toggleBatchTag(t)" />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmBatch">对 {{ selectedIds.length }} 条应用</el-button>
      </template>
    </el-dialog>

    <!-- 维度管理（PM） -->
    <el-dialog v-model="dimVisible" title="场景维度管理" width="600px">
      <el-table :data="dimensions" border size="small">
        <el-table-column label="维度名称" prop="label" width="120" />
        <el-table-column label="标签" min-width="200">
          <template #default="s"><el-tag v-for="t in s.row.tags" :key="t" size="small" style="margin:1px">{{ t }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="60">
          <template #default="s"><el-button text size="small" type="danger" @click="onDeleteDim(s.row)">删除</el-button></template>
        </el-table-column>
      </el-table>
      <div style="margin-top:12px;display:flex;gap:8px">
        <el-input v-model="newDim.label" placeholder="维度名称" style="width:120px" />
        <el-input v-model="newDim.tagsStr" placeholder="标签（逗号分隔）" style="flex:1" />
        <el-button type="primary" size="small" @click="onAddDim">添加</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting, Check } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { request } from '@/api/client.js'
import { fetchTaggingQueue, saveItemTags, batchSaveTags, fetchDim, saveDim, deleteDim } from '@/api/tagging.js'

const userStore = useUserStore()
const canvasRef = ref(null)
const taskOptions = ref([])
const currentTaskId = ref(null)
const items = ref([])
const dimensions = ref([])
const currentItem = ref(null)
const editTags = ref([])
const selectedIds = ref([])
const progress = reactive({ total: 0, tagged: 0 })
const batchVisible = ref(false)
const batchTags = ref([])
const dimVisible = ref(false)
const newDim = reactive({ label: '', tagsStr: '' })
let imgEl = null

async function loadTaskOptions() {
  try {
    const res = await request('/tasks?page=1&pageSize=200')
    taskOptions.value = res.data || []
    if (taskOptions.value.length) { currentTaskId.value = taskOptions.value[0].id; await loadQueue() }
  } catch {}
}

async function loadQueue() {
  if (!currentTaskId.value) return
  const res = await fetchTaggingQueue(currentTaskId.value)
  items.value = res.data.items || []
  dimensions.value = res.data.dimensions || []
  progress.total = res.data.progress?.total || 0
  progress.tagged = res.data.progress?.tagged || 0
  selectedIds.value = []
  currentItem.value = null
}

async function loadDimensions() {
  try { const res = await fetchDim(); dimensions.value = res.data || [] } catch {}
}

function selectItem(it) {
  currentItem.value = it
  editTags.value = [...(it.tags || [])]
  nextTick(loadImage)
}

function loadImage() {
  if (!currentItem.value?.image || !canvasRef.value) return
  imgEl = new Image()
  imgEl.onload = render
  imgEl.src = currentItem.value.image
}

function render() {
  const c = canvasRef.value; if (!c) return
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height)
  if (imgEl) ctx.drawImage(imgEl, 0, 0, c.width, c.height)
}

function toggleTag(tag) {
  const idx = editTags.value.indexOf(tag)
  if (idx >= 0) editTags.value.splice(idx, 1); else editTags.value.push(tag)
}
function toggleBatchTag(tag) {
  const idx = batchTags.value.indexOf(tag)
  if (idx >= 0) batchTags.value.splice(idx, 1); else batchTags.value.push(tag)
}

async function saveCurrent() {
  if (!currentItem.value) return
  try {
    await saveItemTags(currentItem.value.id, editTags.value)
    currentItem.value.tags = [...editTags.value]
    progress.tagged = items.value.filter(i => (i.tags || []).length > 0).length
    ElMessage.success('已保存')
  } catch {}
}

function openBatch() { batchTags.value = []; batchVisible.value = true }
async function confirmBatch() {
  if (!batchTags.value.length) { ElMessage.warning('请选择标签'); return }
  try {
    await batchSaveTags(selectedIds.value, batchTags.value)
    selectedIds.value.forEach(id => { const it = items.value.find(i => i.id === id); if (it) it.tags = [...batchTags.value] })
    progress.tagged = items.value.filter(i => (i.tags || []).length > 0).length
    batchVisible.value = false; selectedIds.value = []
    ElMessage.success('批量打标签完成')
  } catch {}
}

async function openDimEditor() { await loadDimensions(); dimVisible.value = true }
async function onAddDim() {
  if (!newDim.label.trim() || !newDim.tagsStr.trim()) { ElMessage.warning('填写完整'); return }
  try {
    await saveDim({ label: newDim.label.trim(), tags: newDim.tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) })
    newDim.label = ''; newDim.tagsStr = ''
    await loadDimensions()
    ElMessage.success('维度已添加')
  } catch {}
}
async function onDeleteDim(row) {
  try { await deleteDim(row.id); await loadDimensions(); ElMessage.success('已删除') } catch {}
}

onMounted(loadTaskOptions)
</script>

<style scoped>
.tagging-page { display: flex; flex-direction: column; height: calc(100vh - 100px); }
.tg-toolbar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border-radius: 6px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 10px; }
.progress-text { color: #909399; font-size: 13px; white-space: nowrap; }
.tg-body { flex: 1; display: grid; grid-template-columns: 260px 1fr 300px; gap: 12px; min-height: 0; }
.item-list-panel, .canvas-area, .tag-panel { background: #fff; border-radius: 6px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); overflow-y: auto; }
.il-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 4px; cursor: pointer; border: 1px solid #ebeef5; margin-bottom: 6px; }
.il-item:hover { background: #f5f7fa; }
.il-item.active { background: #ecf5ff; border-color: #409eff; }
.il-check { margin-top: 2px; flex-shrink: 0; }
.il-info { flex: 1; min-width: 0; }
.il-name { font-size: 13px; margin-bottom: 4px; }
.il-tags { display: flex; flex-wrap: wrap; gap: 2px; }
.canvas-box { background: #1f1f1f; border-radius: 4px; display: flex; justify-content: center; }
.canvas-box canvas { display: block; width: 100%; max-width: 640px; height: auto; }
.canvas-name { margin-top: 10px; font-weight: bold; font-size: 14px; }
.panel-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; border-left: 3px solid #409eff; padding-left: 8px; }
.dim-group { margin-bottom: 14px; }
.dim-label { font-size: 13px; font-weight: 600; color: #606266; margin-bottom: 6px; }
.dim-tags { display: flex; flex-wrap: wrap; }
.empty-tip { display: flex; align-items: center; justify-content: center; flex: 1; }
</style>
