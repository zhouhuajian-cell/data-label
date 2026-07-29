<template>
  <div class="dataset-page">
    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <div class="body-row">
      <el-card shadow="never" class="list-panel">
        <template #header>
          <div class="panel-head">
            <span>数据集列表（{{ datasets.length }}）</span>
            <div style="display:flex;gap:8px">
              <el-input v-model="searchKey" placeholder="搜索" clearable :prefix-icon="Search" style="width:200px" />
              <el-button v-if="userStore.isAdmin" size="small" :icon="Setting" @click="openDimEditor">维度管理</el-button>
            </div>
          </div>
        </template>
        <el-table :data="filteredDatasets" border size="small" v-loading="loading">
          <el-table-column label="数据集 / 任务" prop="taskName" min-width="160" show-overflow-tooltip />
          <el-table-column label="类型" prop="annotateType" width="100" />
          <el-table-column label="供应商" prop="supplierName" width="90" />
          <el-table-column v-if="!isCleaner" label="验收" prop="acceptedCount" width="70" sortable />
          <el-table-column label="样本量" prop="sampleCount" width="70" />
          <el-table-column label="标签进度" width="110">
            <template #default="s">
              <el-progress :percentage="s.row.sampleCount ? Math.round(s.row.taggedCount/s.row.sampleCount*100) : 0" :stroke-width="6" />
              <span style="font-size:11px;color:#909399">{{ s.row.taggedCount || 0 }}/{{ s.row.sampleCount || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="标签分布" min-width="150">
            <template #default="s">
              <el-tag v-for="l in s.row.labelDist.slice(0,4)" :key="l.name" size="small" style="margin:1px" effect="plain">{{ l.name }}×{{ l.value }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="s">
              <el-button text size="small" type="primary" @click="browseDataset(s.row)">浏览</el-button>
              <el-button v-if="!isCleaner" text size="small" type="success" @click="exportDataset(s.row)">导出COCO</el-button>
            </template>
          </el-table-column>
          <template #empty><el-empty description="暂无数据集" :image-size="80" /></template>
        </el-table>
      </el-card>

      <el-card shadow="hover" class="chart-panel">
        <template #header><span>全局标签分布</span></template>
        <div ref="labelChartRef" style="height:340px"></div>
      </el-card>
    </div>

    <!-- 浏览 + 打标签抽屉 -->
    <el-drawer v-model="browseVisible" :title="currentDataset?.taskName" size="780px">
      <div class="browse-head">
        <el-tag type="info">{{ currentDataset?.annotateType }}</el-tag>
        <span class="browse-count">共 {{ browseItems.length }} 条数据</span>
        <el-button v-if="selectedIds.length" size="small" type="warning" @click="openBatch">批量打标签 ({{ selectedIds.length }})</el-button>
      </div>
      <div class="browse-body">
        <div class="browse-list">
          <el-checkbox-group v-model="selectedIds">
            <div v-for="it in browseItems" :key="it.id" class="browse-item" :class="{ active: currentItem?.id === it.id }" @click="selectBrowseItem(it)">
              <el-checkbox :value="it.id" class="bi-check" @click.stop />
              <div class="bi-info">
                <div class="bi-name">{{ it.itemName }}</div>
                <div class="bi-tags">
                  <el-tag v-for="t in (it.tags||[])" :key="t" size="small" effect="dark" type="success" style="margin:1px">{{ t }}</el-tag>
                  <span v-if="!(it.tags||[]).length" style="color:#c0c4cc;font-size:11px">未打标签</span>
                </div>
              </div>
            </div>
          </el-checkbox-group>
        </div>

        <div class="browse-main">
          <div class="canvas-box"><canvas ref="canvasRef" width="640" height="360" /></div>

          <!-- 场景标签编辑 -->
          <div class="tag-panel">
            <div class="panel-title">场景标签</div>
            <div v-if="currentItem" class="dim-list">
              <div v-for="dim in dimensions" :key="dim.id" class="dim-group">
                <div class="dim-label">{{ dim.label }}</div>
                <div class="dim-tags">
                  <el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="editTags.includes(t)" size="small" style="margin:2px" @change="() => toggleTag(t)" >{{ t }}</el-checkbox-button>
                </div>
              </div>
              <el-button type="primary" :icon="Check" style="width:100%;margin-top:12px" @click="saveCurrent">保存标签</el-button>
            </div>
            <el-empty v-else description="选择数据" :image-size="40" />
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 批量打标签 -->
    <el-dialog v-model="batchVisible" title="批量打标签" width="500px">
      <div class="dim-list">
        <div v-for="dim in dimensions" :key="dim.id" class="dim-group">
          <div class="dim-label">{{ dim.label }}</div>
          <div class="dim-tags">
            <el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="batchTags.includes(t)" size="small" style="margin:2px" @change="() => toggleBatchTag(t)" >{{ t }}</el-checkbox-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmBatch">应用到 {{ selectedIds.length }} 条</el-button>
      </template>
    </el-dialog>

    <!-- 维度管理 -->
    <el-dialog v-model="dimVisible" title="场景维度管理" width="580px">
      <el-table :data="dimensions" border size="small">
        <el-table-column label="维度" prop="label" width="110" />
        <el-table-column label="标签"><template #default="s"><el-tag v-for="t in s.row.tags" :key="t" size="small" style="margin:1px">{{ t }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="60"><template #default="s"><el-button text size="small" type="danger" @click="onDeleteDim(s.row)">删除</el-button></template></el-table-column>
      </el-table>
      <div style="margin-top:12px;display:flex;gap:8px">
        <el-input v-model="newDim.label" placeholder="维度名称" style="width:110px" />
        <el-input v-model="newDim.tagsStr" placeholder="标签（逗号分隔）" style="flex:1" />
        <el-button type="primary" size="small" @click="onAddDim">添加</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { Search, Setting, Check } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { fetchDatasets, fetchDatasetItems } from '@/api/dataset.js'
import { fetchDim, saveDim, deleteDim, saveItemTags, batchSaveTags } from '@/api/tagging.js'

const userStore = useUserStore()
const loading = ref(false)
const datasets = ref([])
const globalLabelDist = ref([])
const searchKey = ref('')
const labelChartRef = ref(null)
let labelChart = null
const canvasRef = ref(null)

const isCleaner = computed(() => userStore.userInfo.roleType === 7)

const browseVisible = ref(false)
const currentDataset = ref(null)
const browseItems = ref([])
const currentItem = ref(null)
const selectedIds = ref([])
const dimensions = ref([])
const editTags = ref([])
const batchVisible = ref(false)
const batchTags = ref([])
const dimVisible = ref(false)
const newDim = reactive({ label: '', tagsStr: '' })
let imgEl = null

const totalAccepted = computed(() => datasets.value.reduce((a, d) => a + d.acceptedCount, 0))
const totalTagged = computed(() => datasets.value.reduce((a, d) => a + d.taggedCount, 0))
const totalLabels = computed(() => globalLabelDist.value.length)

const statCards = computed(() => {
  if (isCleaner.value) return [
    { key: 'datasets', val: datasets.value.length, label: '任务总数', color: '#409eff' },
    { key: 'accepted', val: totalAccepted.value, label: '验收数据', color: '#67c23a' },
    { key: 'tagged', val: totalTagged.value, label: '已打标签', color: '#e6a23c' },
    { key: 'labels', val: totalLabels.value, label: '标签类别', color: '#909399' }
  ]
  return [
    { key: 'datasets', val: datasets.value.length, label: '数据集总数', color: '#409eff' },
    { key: 'accepted', val: totalAccepted.value, label: '验收明细', color: '#67c23a' },
    { key: 'tagged', val: totalTagged.value, label: '已打标签', color: '#e6a23c' },
    { key: 'labels', val: totalLabels.value, label: '标签类别', color: '#909399' }
  ]
})

const filteredDatasets = computed(() => {
  if (!searchKey.value.trim()) return datasets.value
  const k = searchKey.value.trim().toLowerCase()
  return datasets.value.filter(d => d.taskName.toLowerCase().includes(k))
})

async function loadData() {
  loading.value = true
  try {
    const res = await fetchDatasets()
    datasets.value = res.data.datasets || []
    globalLabelDist.value = res.data.globalLabelDist || []
    await nextTick(); initChart()
  } catch { datasets.value = [] }
  finally { loading.value = false }
}

function initChart() {
  if (!labelChartRef.value) return
  if (labelChart) { labelChart.dispose() }
  labelChart = echarts.init(labelChartRef.value)
  labelChart.setOption({
    tooltip: { trigger: 'item' }, legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['38%', '66%'], data: globalLabelDist.value.length ? globalLabelDist.value : [{ name: '暂无', value: 1 }], label: { formatter: '{b}: {c}' } }]
  })
}

// 浏览
async function browseDataset(row) {
  currentDataset.value = row; browseVisible.value = true; browseItems.value = []; currentItem.value = null; selectedIds.value = []
  try {
    const res = await fetchDatasetItems(row.taskId); browseItems.value = res.data.items || []
    if (browseItems.value.length) selectBrowseItem(browseItems.value[0])
  } catch {}
  try { const dim = await fetchDim(); dimensions.value = dim.data || [] } catch {}
}

function selectBrowseItem(it) {
  currentItem.value = it; editTags.value = [...(it.tags || [])]
  nextTick(() => { if (it.image && canvasRef.value) { imgEl = new Image(); imgEl.onload = renderCanvas; imgEl.src = it.image } })
}

function renderCanvas() {
  const c = canvasRef.value; if (!c) return
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height)
  if (imgEl) ctx.drawImage(imgEl, 0, 0, c.width, c.height)
  const colors = ['#ff4d4f', '#52c41a', '#1890ff', '#faad14', '#722ed1', '#13c2c2']
  ;(currentItem.value?.boxes || []).forEach((b, i) => {
    const color = colors[i % colors.length]
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = color; ctx.font = '13px sans-serif'
    const lw = ctx.measureText(b.label).width + 8
    ctx.fillRect(b.x, Math.max(0, b.y - 18), lw, 18)
    ctx.fillStyle = '#fff'; ctx.fillText(b.label, b.x + 4, Math.max(13, b.y - 4))
  })
}

// 标签编辑
function toggleTag(t) { const idx = editTags.value.indexOf(t); if (idx >= 0) editTags.value.splice(idx, 1); else editTags.value.push(t) }
function toggleBatchTag(t) { const idx = batchTags.value.indexOf(t); if (idx >= 0) batchTags.value.splice(idx, 1); else batchTags.value.push(t) }

async function saveCurrent() {
  if (!currentItem.value) return
  try {
    await saveItemTags(currentItem.value.id, editTags.value)
    currentItem.value.tags = [...editTags.value]
    ElMessage.success('已保存')
    loadData() // 刷新进度
  } catch {}
}

function openBatch() { batchTags.value = []; batchVisible.value = true }
async function confirmBatch() {
  if (!batchTags.value.length) { ElMessage.warning('请选择标签'); return }
  try {
    await batchSaveTags(selectedIds.value, batchTags.value)
    selectedIds.value.forEach(id => { const it = browseItems.value.find(i => i.id === id); if (it) it.tags = [...batchTags.value] })
    batchVisible.value = false; selectedIds.value = []
    ElMessage.success('批量完成'); loadData()
  } catch {}
}

// 维度管理
async function openDimEditor() { try { const d = await fetchDim(); dimensions.value = d.data || [] } catch {}; dimVisible.value = true }
async function onAddDim() {
  if (!newDim.label.trim() || !newDim.tagsStr.trim()) { ElMessage.warning('填写完整'); return }
  try { await saveDim({ label: newDim.label.trim(), tags: newDim.tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); newDim.label = ''; newDim.tagsStr = ''; openDimEditor(); ElMessage.success('已添加') } catch {}
}
async function onDeleteDim(row) { try { await deleteDim(row.id); openDimEditor(); ElMessage.success('已删除') } catch {} }

// 导出
async function exportDataset(row) {
  const token = localStorage.getItem('token') || ''
  try {
    const res = await fetch(`/api/datasets/${row.taskId}/export`, { headers: { Authorization: 'Bearer ' + token } })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `dataset_task${row.taskId}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    ElMessage.success('已导出')
  } catch { ElMessage.error('导出失败') }
}

function handleResize() { labelChart?.resize() }
onMounted(() => { loadData(); window.addEventListener('resize', handleResize) })
onUnmounted(() => { window.removeEventListener('resize', handleResize); labelChart?.dispose() })
</script>

<style scoped>
.dataset-page { --gap: 12px; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--gap); margin-bottom: var(--gap); }
.stat-card { text-align: center; }
.stat-num { font-size: 28px; font-weight: bold; }
.stat-label { color: #909399; margin-top: 6px; font-size: 13px; }
.body-row { display: grid; grid-template-columns: 1fr 340px; gap: var(--gap); align-items: start; }
.panel-head { display: flex; justify-content: space-between; align-items: center; }
.browse-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.browse-count { color: #909399; font-size: 13px; flex:1 }
.browse-body { display: grid; grid-template-columns: 200px 1fr; gap: 12px; height: calc(100vh - 180px); }
.browse-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; max-height: 100%; }
.browse-item { display: flex; align-items: flex-start; gap: 6px; padding: 8px; border: 1px solid #ebeef5; border-radius: 4px; cursor: pointer; font-size: 13px; }
.browse-item:hover { background: #f5f7fa; }
.browse-item.active { background: #ecf5ff; border-color: #409eff; }
.bi-check { margin-top: 2px; flex-shrink: 0; }
.bi-info { flex: 1; min-width: 0; }
.bi-name { margin-bottom: 3px; }
.bi-tags { display: flex; flex-wrap: wrap; gap: 1px; }
.browse-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow-y: auto; }
.canvas-box { background: #1f1f1f; border-radius: 4px; display: flex; justify-content: center; }
.canvas-box canvas { display: block; width: 100%; max-width: 640px; height: auto; }
.tag-panel { }
.panel-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; border-left: 3px solid #409eff; padding-left: 8px; }
.dim-group { margin-bottom: 12px; }
.dim-label { font-size: 13px; font-weight: 600; color: #606266; margin-bottom: 5px; }
.dim-tags { display: flex; flex-wrap: wrap; }
.dim-list { max-height: none; }
</style>
