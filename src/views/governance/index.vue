<template>
  <div class="gov-page">
    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="panel-head">
          <span>数据集列表（{{ datasets.length }}）</span>
            <el-button type="primary" :icon="Upload" @click="openImport">导入数据</el-button>
            <el-button v-if="userStore.isAdmin" size="small" :icon="Setting" @click="openDimEditor">维度管理</el-button>
        </div>
      </template>
      <el-table :data="datasets" border size="small" v-loading="loading">
        <el-table-column label="数据集名称" prop="name" min-width="200" show-overflow-tooltip>
          <template #default="s">{{ s.row.name }}<span style="color:#909399;font-size:11px;margin-left:8px">{{ s.row.fileName }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="s">
            <el-tag :type="s.row.status === 'TAGGED' ? 'success' : 'warning'" size="small">{{ s.row.status === 'TAGGED' ? '已清洗' : 'Raw' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="数据量" prop="itemCount" width="80" />
        <el-table-column label="标签进度" width="140">
          <template #default="s">
            <el-progress :percentage="s.row.itemCount ? Math.round(s.row.taggedCount/s.row.itemCount*100) : 0" :stroke-width="6" />
            <span style="font-size:11px">{{ s.row.taggedCount || 0 }}/{{ s.row.itemCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="导入人" prop="creatorName" width="100" />
        <el-table-column label="时间" prop="uploadTime" width="150" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="s">
            <el-button text size="small" type="primary" @click="browseDataset(s.row)">浏览打标签</el-button>
            <el-button v-if="s.row.status === 'RAW'" text size="small" type="success" @click="onMarkTagged(s.row)">标记已清洗</el-button>
            <el-button text size="small" type="warning" @click="onMarkTagged(s.row, 'RAW')">退回</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无治理数据集" :image-size="80" /></template>
      </el-table>
    </el-card>

    <!-- 导入 -->
    <el-dialog v-model="importVisible" title="数据导入" width="520px">
      <el-steps :active="importStep" simple class="import-steps">
        <el-step title="选择文件" />
        <el-step title="配置信息" />
      </el-steps>

      <div v-show="importStep === 0" style="margin-top:20px">
        <el-upload drag :auto-upload="false" :on-change="onFileChange" :limit="1" accept=".zip,.tar,.gz,.7z" class="import-upload">
          <el-icon size="40"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽数据包或<em>点击上传</em></div>
          <template #tip><div class="el-upload__tip">支持 zip/tar.gz 压缩包</div></template>
        </el-upload>
        <div v-if="importForm.fileName" class="file-selected">
          <el-icon><Document /></el-icon>
          <span>已选择：{{ importForm.fileName }}</span>
          <span style="color:#909399">{{ formatSize(importForm.fileSize) }}</span>
        </div>
      </div>

      <div v-show="importStep === 1" style="margin-top:20px">
        <el-form label-width="90px">
          <el-form-item label="数据集名称" required><el-input v-model="importForm.name" placeholder="如 DS_001_street_scenes" /></el-form-item>
          <el-form-item label="数据量"><el-input-number v-model="importForm.itemCount" :min="1" :max="500" style="width:100%" /></el-form-item>
          <el-alert type="info" :closable="false" title="系统将自动解压、计算MD5、提取元数据，生成逻辑 Dataset" style="margin-top:8px" />
        </el-form>
      </div>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button v-if="importStep === 0" type="primary" :disabled="!importForm.fileName" @click="importStep=1">下一步</el-button>
        <template v-else>
          <el-button @click="importStep=0">上一步</el-button>
          <el-button type="primary" :loading="actionLoading" :disabled="!importForm.name" @click="onImport">确认导入</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 浏览 + 打标签抽屉 -->
    <el-drawer v-model="browseVisible" :title="currentDS?.name" size="780px">
      <div class="browse-head">
        <el-tag :type="currentDS?.status === 'TAGGED' ? 'success' : 'warning'">{{ currentDS?.status === 'TAGGED' ? '已清洗' : 'Raw' }}</el-tag>
        <span class="browse-count">共 {{ browseItems.length }} 条数据</span>
        <el-button v-if="selectedIds.length" size="small" type="warning" @click="openBatch">批量打标签 ({{ selectedIds.length }})</el-button>
      </div>
      <div class="browse-body">
        <div class="browse-list">
          <el-checkbox-group v-model="selectedIds">
            <div v-for="it in browseItems" :key="it.id" class="browse-item" :class="{ active: currentItem?.id === it.id }" @click="selectItem(it)">
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
          <div class="tag-panel">
            <div class="ps-title">场景标签</div>
            <div v-if="currentItem" class="dim-list">
              <div v-for="dim in dimensions" :key="dim.id" class="dim-group">
                <div class="dim-label">{{ dim.label }}</div>
                <div class="dim-tags">
                  <el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="editTags.includes(t)" size="small" style="margin:2px" @change="() => toggleTag(t)" >{{ t }}</el-checkbox-button>
                </div>
              </div>
              <el-button type="primary" :icon="Check" style="width:100%;margin-top:12px" @click="saveTag">保存标签</el-button>
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
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Check, UploadFilled, Document, Setting } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { fetchGovernedDatasets, fetchGovernedDetail, importDataset, updateDatasetStatus, tagGovernedItem, batchTagGovernedItems } from '@/api/governance.js'
import { fetchDim, saveDim, deleteDim } from '@/api/tagging.js'

const userStore = useUserStore()

const loading = ref(false)
const actionLoading = ref(false)
const datasets = ref([])
const canvasRef = ref(null)

const importVisible = ref(false)
const importStep = ref(0)
const importForm = reactive({ name: '', fileName: '', fileSize: 0, itemCount: 30 })

const browseVisible = ref(false)
const currentDS = ref(null)
const browseItems = ref([])
const currentItem = ref(null)
const selectedIds = ref([])
const dimensions = ref([])
const editTags = ref([])
const batchVisible = ref(false)
const batchTags = ref([])
let imgEl = null

const totalItems = computed(() => datasets.value.reduce((a, d) => a + d.itemCount, 0))
const totalTagged = computed(() => datasets.value.reduce((a, d) => a + d.taggedCount, 0))

const statCards = computed(() => [
  { key: 'total', val: datasets.value.length, label: '数据集', color: '#409eff' },
  { key: 'items', val: totalItems.value, label: '数据总量', color: '#67c23a' },
  { key: 'tagged', val: totalTagged.value, label: '已打标签', color: '#e6a23c' },
  { key: 'done', val: datasets.value.filter(d => d.status === 'TAGGED').length, label: '已清洗', color: '#909399' }
])

async function loadData() { loading.value = true; try { const r = await fetchGovernedDatasets(); datasets.value = r.data || [] } catch {} finally { loading.value = false } }

function openImport() { importStep.value = 0; importForm.name = ''; importForm.fileName = ''; importForm.fileSize = 0; importForm.itemCount = 30; importVisible.value = true }

function onFileChange(file) {
  const raw = file.raw || file
  importForm.fileName = raw.name
  importForm.fileSize = raw.size
  if (!importForm.name) importForm.name = raw.name.replace(/\.(zip|tar|gz|7z)$/i, '')
  // 从文件名猜测数据量后缀 _N → 如 data_30.zip
  const match = raw.name.match(/_(\d+)\./)
  if (match) importForm.itemCount = Math.min(Number(match[1]), 500)
}

function formatSize(b) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let s = b
  while (s >= 1024 && i < 3) { s /= 1024; i++ }
  return s.toFixed(1) + ' ' + u[i]
}

async function onImport() {
  if (!importForm.name.trim()) { ElMessage.warning('请输入数据集名称'); return }
  actionLoading.value = true
  try { await importDataset({ ...importForm }); ElMessage.success('数据已导入，系统已自动解压并生成 Dataset'); importVisible.value = false; loadData() } catch {} finally { actionLoading.value = false }
}

async function onMarkTagged(row, status) {
  const targetStatus = status || 'TAGGED'
  const label = targetStatus === 'TAGGED' ? '标记已清洗（数据可被项目引用）' : '退回为 Raw 状态'
  try { await ElMessageBox.confirm(`确认将「${row.name}」${label}？`, '状态变更', { type: 'warning' }) } catch { return }
  try { await updateDatasetStatus(row.id, targetStatus); row.status = targetStatus; ElMessage.success('已更新') } catch {}
}

async function browseDataset(row) {
  currentDS.value = row; browseVisible.value = true; browseItems.value = []; currentItem.value = null; selectedIds.value = []
  try { const r = await fetchGovernedDetail(row.id); browseItems.value = r.data.items || []; if (browseItems.value.length) selectItem(browseItems.value[0]) } catch {}
  try { const d = await fetchDim(); dimensions.value = d.data || [] } catch {}
}

function selectItem(it) { currentItem.value = it; editTags.value = [...(it.tags || [])]; nextTick(loadCanvas) }

function loadCanvas() { if (!currentItem.value?.image || !canvasRef.value) return; imgEl = new Image(); imgEl.onload = renderCanvas; imgEl.src = currentItem.value.image }

function renderCanvas() { const c = canvasRef.value; if (!c) return; const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); if (imgEl) ctx.drawImage(imgEl, 0, 0, c.width, c.height) }

function toggleTag(t) { const idx = editTags.value.indexOf(t); if (idx >= 0) editTags.value.splice(idx, 1); else editTags.value.push(t) }
function toggleBatchTag(t) { const idx = batchTags.value.indexOf(t); if (idx >= 0) batchTags.value.splice(idx, 1); else batchTags.value.push(t) }

async function saveTag() {
  if (!currentItem.value) return
  try { await tagGovernedItem(currentItem.value.id, editTags.value); currentItem.value.tags = [...editTags.value]; ElMessage.success('已保存'); loadData() } catch {}
}

function openBatch() { batchTags.value = []; batchVisible.value = true }
async function confirmBatch() {
  if (!batchTags.value.length) { ElMessage.warning('请选择标签'); return }
  try { await batchTagGovernedItems(selectedIds.value, batchTags.value); selectedIds.value.forEach(id => { const it = browseItems.value.find(i => i.id === id); if (it) it.tags = [...batchTags.value] }); batchVisible.value = false; selectedIds.value = []; ElMessage.success('批量完成'); loadData() } catch {}
}

onMounted(loadData)

// 维度管理（PM 增删场景标签）
const dimVisible = ref(false)
const newDim = reactive({ label: '', tagsStr: '' })
async function openDimEditor() { try { const d = await fetchDim(); dimensions.value = d.data || [] } catch {}; dimVisible.value = true }
async function onAddDim() {
  if (!newDim.label.trim() || !newDim.tagsStr.trim()) { ElMessage.warning('填写完整'); return }
  try { await saveDim({ label: newDim.label.trim(), tags: newDim.tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); newDim.label = ''; newDim.tagsStr = ''; openDimEditor(); ElMessage.success('已添加') } catch {}
}
async function onDeleteDim(row) { try { await deleteDim(row.id); openDimEditor(); ElMessage.success('已删除') } catch {} }
</script>

<style scoped>
.gov-page { --gap: 12px; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--gap); margin-bottom: var(--gap); }
.stat-card { text-align: center; }
.stat-num { font-size: 28px; font-weight: bold; }
.stat-label { color: #909399; margin-top: 6px; font-size: 13px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; }
.browse-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.browse-count { color: #909399; font-size: 13px; flex: 1 }
.browse-body { display: grid; grid-template-columns: 200px 1fr; gap: 12px; height: calc(100vh - 180px); }
.browse-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
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
.ps-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; border-left: 3px solid #409eff; padding-left: 8px; }
.dim-group { margin-bottom: 12px; }
.dim-label { font-size: 13px; font-weight: 600; color: #606266; margin-bottom: 5px; }
.dim-tags { display: flex; flex-wrap: wrap; }
.import-steps { margin-bottom: 4px; }
.import-upload { width: 100%; }
.file-selected { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f0f9eb; border-radius: 4px; margin-top: 12px; font-size: 13px; color: #67c23a; }
</style>
