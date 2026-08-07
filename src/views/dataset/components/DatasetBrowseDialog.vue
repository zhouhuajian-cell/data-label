<template>
  <!-- 浏览（含画布标注预览 + 打标签 + 维度管理） -->
  <el-drawer v-model="visible" :title="currentDS?.name" size="780px">
    <div class="browse-head">
      <el-tag :type="currentDS?.status==='TAGGED'?'success':'warning'">{{ currentDS?.status }}</el-tag>
      <span class="browse-count">{{ items.length }}条</span>
      <el-button v-if="selectedIds.length" size="small" type="warning" @click="openBatch">批量打标签({{selectedIds.length}})</el-button>
    </div>
    <div class="browse-body">
      <div class="browse-list">
        <el-checkbox-group v-model="selectedIds">
          <div v-for="it in items" :key="it.id" class="b-item" :class="{active:currentItem?.id===it.id}" @click="selectItem(it)">
            <el-checkbox :value="it.id" class="bi-check" @click.stop/>
            <div class="bi-info"><div class="bi-name">{{ it.itemName }}</div>
              <div class="bi-tags"><el-tag v-for="t in (it.tags||[])" :key="t" size="small" effect="dark" type="success" style="margin:1px;cursor:pointer" @click.stop="removeTag(it,t)">{{ t }} ✕</el-tag><span v-if="!(it.tags||[]).length" style="color:#c0c4cc;font-size:11px">未打标签</span></div>
            </div>
            <el-button text size="small" type="danger" style="margin-left:auto;flex-shrink:0" @click.stop="onDeleteItem(it)">✕</el-button>
          </div>
        </el-checkbox-group>
      </div>
      <div class="browse-main">
        <div class="canvas-box"><canvas ref="canvasRef" width="640" height="360"/></div>
        <div class="tag-panel"><div class="ps-title">场景标签</div>
          <div v-if="currentItem" class="dim-list">
            <div v-for="dim in dimensions" :key="dim.id" class="dim-g"><div class="dim-l">{{ dim.label }}</div>
              <div class="dim-t"><el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="editTags.includes(t)" size="small" style="margin:2px" @change="()=>toggleTag(t)">{{ t }}</el-checkbox-button></div>
            </div>
            <div class="dim-g"><div class="dim-l">字段编辑（点击选择）</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <div><div style="font-size:12px;color:#909399">批次</div><el-select v-model="editMeta.batch" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.batch" :key="v" :label="v" :value="v" /></el-select></div>
                <div><div style="font-size:12px;color:#909399">车型</div><el-select v-model="editMeta.model" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.model" :key="v" :label="v" :value="v" /></el-select></div>
                <div><div style="font-size:12px;color:#909399">单包检测</div><el-select v-model="editMeta.check" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.check" :key="v" :label="v" :value="v" /></el-select></div>
                <div><div style="font-size:12px;color:#909399">场景</div><el-select v-model="editMeta.scene" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.scene" :key="v" :label="v" :value="v" /></el-select></div>
                <div><div style="font-size:12px;color:#909399">清洗人</div><el-select v-model="editMeta.cleaner" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.cleaner" :key="v" :label="v" :value="v" /></el-select></div>
              </div>
            </div>
            <div class="dim-g"><div class="dim-l">清洗时间</div>
              <el-date-picker v-model="editCleanTime" type="datetime" size="small" style="width:100%" value-format="YYYY-MM-DD HH:mm:ss" />
            </div>
            <el-button type="primary" :icon="Check" style="width:100%;margin-top:12px" @click="saveTag">保存标签</el-button>
          </div>
          <el-empty v-else description="选择数据" :image-size="40"/>
        </div>
      </div>
    </div>
  </el-drawer>

  <!-- 批量打标签 -->
  <el-dialog v-model="batchVisible" title="批量打标签" width="500px">
    <div class="dim-list"><div v-for="dim in dimensions" :key="dim.id" class="dim-g"><div class="dim-l">{{ dim.label }}</div>
      <div class="dim-t"><el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="batchTags.includes(t)" size="small" style="margin:2px" @change="()=>toggleBatchTag(t)">{{ t }}</el-checkbox-button></div>
    </div></div>
    <template #footer><el-button @click="batchVisible=false">取消</el-button><el-button type="primary" @click="confirmBatch">应用到{{selectedIds.length}}条</el-button></template>
  </el-dialog>

  <!-- 维度管理 -->
  <el-dialog v-model="dimVisible" title="场景维度管理" width="580px">
    <el-table :data="dimensions" border size="small">
      <el-table-column label="维度" prop="label" width="110"/>
      <el-table-column label="标签"><template #default="s"><el-tag v-for="t in s.row.tags" :key="t" size="small" style="margin:1px">{{ t }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="60"><template #default="s"><el-button text size="small" type="danger" @click="onDeleteDim(s.row)">删除</el-button></template></el-table-column>
    </el-table>
    <div style="margin-top:12px;display:flex;gap:8px"><el-input v-model="newDim.label" placeholder="维度名称" style="width:110px"/><el-input v-model="newDim.tagsStr" placeholder="标签(逗号分隔)" style="flex:1"/><el-button type="primary" size="small" @click="onAddDim">添加</el-button></div>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check } from '@element-plus/icons-vue'
import { fetchDatasetItems } from '@/api/dataset.js'
import { fetchGovernedDetail, tagGovernedItem, batchTagGovernedItems, deleteGovernedItem } from '@/api/governance.js'
import { fetchDim, saveDim, deleteDim, saveItemTags, batchSaveTags } from '@/api/tagging.js'
import { deleteTaskItemApi } from '@/api/items.js'

const emit = defineEmits(['changed'])

const visible = ref(false)
const currentDS = ref(null)
const items = ref([])
const currentItem = ref(null)
const selectedIds = ref([])
const editTags = ref([])
const dimensions = ref([])
const customTag = ref('')
const editCleanTime = ref('')
const editMeta = reactive({ batch: [], model: [], check: [], scene: [], cleaner: [] })
const batchVisible = ref(false)
const batchTags = ref([])
const dimVisible = ref(false)
const newDim = reactive({ label: '', tagsStr: '' })
const canvasRef = ref(null)
let imgEl = null

const fieldPool = computed(() => {
  const sceneSet = new Set(), modelSet = new Set()
  const batchSet = new Set(), checkSet = new Set(), cleanerSet = new Set()
  dimensions.value.forEach(d => {
    if (/车型|model/i.test(d.label)) d.tags.forEach(t => modelSet.add(t))
    else d.tags.forEach(t => sceneSet.add(t))
  })
  items.value.forEach(it => {
    const m = it.metadata || {}
    if (m.batch) (m.batch.split(',') || []).forEach(v => batchSet.add(v))
    if (m.check) (m.check.split(',') || []).forEach(v => checkSet.add(v))
    if (m.cleaner) (m.cleaner.split(',') || []).forEach(v => cleanerSet.add(v))
    if (m.model) (m.model.split(',') || []).forEach(v => modelSet.add(v))
    if (m.sceneStr) (m.sceneStr.split(',') || []).forEach(v => sceneSet.add(v))
  })
  return { batch: [...batchSet], model: [...modelSet], check: [...checkSet], scene: [...sceneSet], cleaner: [...cleanerSet] }
})

async function open(row) {
  currentDS.value = row
  visible.value = true
  items.value = []
  currentItem.value = null
  selectedIds.value = []
  try {
    let data
    if (row.source === 'gov') { const r = await fetchGovernedDetail(row.id); data = r.data?.items }
    else { const r = await fetchDatasetItems(row.taskId || row.itemId || row.id); data = r.data?.items }
    items.value = data || []
    if (items.value.length) selectItem(items.value[0])
  } catch {}
  try { const d = await fetchDim(); dimensions.value = d.data || [] } catch {}
}

// 单条查看（数据集行「查看」入口）
function openSingle(dsRow, itemRow) {
  currentDS.value = dsRow
  visible.value = true
  items.value = [itemRow]
  currentItem.value = itemRow
  selectedIds.value = []
  editTags.value = [...(itemRow.tags || [])]
  nextTick(() => {
    if (itemRow.image && canvasRef.value) { imgEl = new Image(); imgEl.onload = renderCanvas; imgEl.src = itemRow.image }
  })
}
defineExpose({ open, openSingle })

function selectItem(it) {
  currentItem.value = it
  editTags.value = [...(it.tags || [])]
  const ct = it.metadata?.cleanTime
  const now = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
  editCleanTime.value = ct || now
  const m = it.metadata || {}
  editMeta.batch = m.batch ? [m.batch] : []
  editMeta.model = m.model ? [m.model] : []
  editMeta.check = m.check ? [m.check] : []
  editMeta.scene = m.sceneStr ? [m.sceneStr] : []
  editMeta.cleaner = m.cleaner ? [m.cleaner] : []
  customTag.value = ''
  nextTick(() => {
    if (it.image && canvasRef.value) { imgEl = new Image(); imgEl.onload = renderCanvas; imgEl.src = it.image }
  })
}

function renderCanvas() {
  const c = canvasRef.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  if (imgEl) ctx.drawImage(imgEl, 0, 0, c.width, c.height)
  const cols = ['#ff4d4f', '#52c41a', '#1890ff', '#faad14', '#722ed1', '#13c2c2']
  ;(currentItem.value?.boxes || []).forEach((b, i) => {
    const co = cols[i % cols.length]
    ctx.strokeStyle = co; ctx.lineWidth = 2
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = co; ctx.font = '13px sans-serif'
    const lw = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), lw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })
}

const toggleTag = (t) => { const i = editTags.value.indexOf(t); if (i >= 0) editTags.value.splice(i, 1); else editTags.value.push(t) }
const toggleBatchTag = (t) => { const i = batchTags.value.indexOf(t); if (i >= 0) batchTags.value.splice(i, 1); else batchTags.value.push(t) }

// 保存标签（治理用 governance API，生产用 tagging API）
async function saveTag() {
  if (!currentItem.value) return
  const isGov = currentDS.value?.source === 'gov'
  try {
    if (isGov) {
      await tagGovernedItem(currentItem.value.id, { tags: editTags.value, cleanTime: editCleanTime.value, batch: (editMeta.batch || []).join(','), model: (editMeta.model || []).join(','), check: (editMeta.check || []).join(','), scene: (editMeta.scene || []).join(','), cleaner: (editMeta.cleaner || []).join(',') })
    } else {
      await saveItemTags(currentItem.value.id, editTags.value)
    }
    currentItem.value.tags = [...editTags.value]
    if (currentItem.value.metadata) {
      Object.assign(currentItem.value.metadata, { cleanTime: editCleanTime.value, batch: (editMeta.batch || []).join(','), model: (editMeta.model || []).join(','), check: (editMeta.check || []).join(','), sceneStr: (editMeta.scene || []).join(','), cleaner: (editMeta.cleaner || []).join(',') })
    }
    ElMessage.success('已保存'); emit('changed')
  } catch {}
}

const openBatch = () => { batchTags.value = []; batchVisible.value = true }
async function confirmBatch() {
  if (!batchTags.value.length) { ElMessage.warning('请选择标签'); return }
  const isGov = currentDS.value?.source === 'gov'
  try {
    const fn = isGov ? batchTagGovernedItems : batchSaveTags
    await fn(selectedIds.value, batchTags.value)
    selectedIds.value.forEach(id => { const it = items.value.find(i => i.id === id); if (it) it.tags = [...batchTags.value] })
    batchVisible.value = false; selectedIds.value = []
    ElMessage.success('完成'); emit('changed')
  } catch {}
}

// 维度
async function openDimEditor() { try { const d = await fetchDim(); dimensions.value = d.data || [] } catch {}; dimVisible.value = true }
async function onAddDim() {
  if (!newDim.label.trim() || !newDim.tagsStr.trim()) { ElMessage.warning('填写完整'); return }
  try {
    await saveDim({ label: newDim.label.trim(), tags: newDim.tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) })
    newDim.label = ''; newDim.tagsStr = ''; openDimEditor(); ElMessage.success('已添加')
  } catch {}
}
async function onDeleteDim(r) { try { await deleteDim(r.id); openDimEditor(); ElMessage.success('已删除') } catch {} }

async function onDeleteItem(it) {
  try { await ElMessageBox.confirm(`删除「${it.itemName}」？`, '确认删除', { type: 'warning' }) } catch { return }
  const isGov = currentDS.value?.source === 'gov'
  try {
    if (isGov) { await deleteGovernedItem(it.id) } else { await deleteTaskItemApi(currentDS.value.taskId || currentDS.value.id, it.id) }
    items.value = items.value.filter(i => i.id !== it.id)
    if (currentItem.value?.id === it.id) currentItem.value = null
    ElMessage.success('已删除'); emit('changed')
  } catch { ElMessage.error('删除失败') }
}

async function removeTag(it, tag) {
  it.tags = (it.tags || []).filter(t => t !== tag)
  if (currentItem.value?.id === it.id) editTags.value = editTags.value.filter(t => t !== tag)
  const isGov = currentDS.value?.source === 'gov'
  try { await (isGov ? tagGovernedItem : saveItemTags)(it.id, it.tags); emit('changed') } catch {}
}
</script>

<style scoped>
.browse-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.browse-count { color: #909399; font-size: 13px; }
.browse-body { display: flex; gap: 12px; height: calc(100vh - 120px); }
.browse-list { width: 250px; overflow-y: auto; border-right: 1px solid #ebeef5; padding-right: 10px; }
.b-item { display: flex; align-items: center; gap: 6px; padding: 8px; border-radius: 6px; cursor: pointer; }
.b-item.active { background: #ecf5ff; }
.bi-check { margin-right: 4px; }
.bi-info { min-width: 0; flex: 1; }
.bi-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bi-tags { margin-top: 4px; }
.browse-main { flex: 1; overflow-y: auto; }
.canvas-box canvas { width: 100%; border: 1px solid #ebeef5; border-radius: 6px; background: #f5f7fa; }
.tag-panel { margin-top: 12px; }
.ps-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.dim-g { margin-bottom: 10px; }
.dim-l { font-size: 12px; color: #909399; margin-bottom: 4px; }
</style>
