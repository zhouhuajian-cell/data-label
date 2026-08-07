<template>
  <el-dialog v-model="visible" title="数据导入" width="520px">
    <el-steps :active="importStep" simple class="import-steps"><el-step title="选择文件"/><el-step title="配置信息"/></el-steps>
    <div style="margin-bottom:8px">
      <el-radio-group v-model="importMode" size="small">
        <el-radio-button value="file">上传文件</el-radio-button>
        <el-radio-button value="paste">粘贴数据</el-radio-button>
      </el-radio-group>
    </div>
    <div v-show="importStep===0 && importMode==='file'" style="margin-top:12px">
      <input type="file" ref="fileInputRef" accept=".csv,.xlsx,.xls,.zip,.json,.jsonl" style="display:none" @change="onNativeFileChange" />
      <div class="drop-zone" @click="fileInputRef?.click()" @dragover.prevent @drop.prevent="onDrop">
        <el-icon size="40"><UploadFilled /></el-icon>
        <div class="el-upload__text">点击或拖拽文件到这里</div>
      </div>
      <div v-if="importForm.fileName" class="file-sel"><el-icon><Document /></el-icon>{{ importForm.fileName }}</div>
    </div>
    <div v-show="importStep===0 && importMode==='paste'" style="margin-top:12px">
      <el-input v-model="pasteText" type="textarea" :rows="10" placeholder="源数据路径（logs）,批次,车型,单包检测,场景,清洗人,清洗时间,感知意见" />
      <el-button style="margin-top:8px" type="primary" size="small" @click="onParsePaste">解析并继续</el-button>
    </div>
    <div v-show="importStep===1" style="margin-top:20px">
      <el-form label-width="90px">
        <el-form-item label="数据集名称" required><el-input v-model="importForm.name" placeholder="如 DS_001_street"/></el-form-item>
        <el-form-item label="数据量"><el-input-number v-model="importForm.itemCount" :min="1" :max="500" style="width:100%"/></el-form-item>
        <el-form-item v-if="isVideo" label="提取帧数"><span style="color:#909399;font-size:13px">视频将按每 {{ Math.ceil(importForm.itemCount/10) }} 帧抽取 1 帧，模拟生成 {{ importForm.itemCount }} 个样本帧</span></el-form-item>
        <el-alert type="info" :closable="false" :title="isVideo ? '视频文件将抽帧生成 Dataset' : '系统将自动解压、MD5校验、抽取元数据'" style="margin-top:8px"/>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="visible=false">取消</el-button>
      <el-button v-if="importStep===0" type="primary" :disabled="!importForm.fileName" @click="importStep=1">下一步</el-button>
      <template v-else><el-button @click="importStep=0">上一步</el-button><el-button type="primary" :loading="loading" :disabled="!importForm.name" @click="onImport">确认导入</el-button></template>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document } from '@element-plus/icons-vue'
import { importDataset, importDatasetFile } from '@/api/governance'

const emit = defineEmits(['imported'])

const visible = ref(false)
const loading = ref(false)
const importStep = ref(0)
const importMode = ref('file')
const pasteText = ref('')
const importForm = ref({ name: '', fileName: '', fileSize: 0, itemCount: 30 })
const rawFile = ref(null)
const fileInputRef = ref(null)
const isVideo = computed(() => /\.(mp4|avi|mov|mkv)$/i.test(importForm.value.fileName))

const open = () => {
  importStep.value = 0; importMode.value = 'file'
  importForm.value = { name: '', fileName: '', fileSize: 0, itemCount: 30 }
  rawFile.value = null; pasteText.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
  visible.value = true
}
defineExpose({ open })

function onNativeFileChange(e) { handleFile(e.target.files[0]) }
function onDrop(e) { handleFile(e.dataTransfer?.files[0]) }
function handleFile(file) {
  if (!file) return
  rawFile.value = file
  importForm.value.fileName = file.name
  importForm.value.fileSize = file.size
  const m = (file.name || '').match(/[-_](\d+)(?=\.\w+$)/)
  importForm.value.itemCount = m ? Math.min(Number(m[1]), 500) : 30
}
function fmtSize(b) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, s = b; while (s >= 1024 && i < 3) { s /= 1024; i++ } return s.toFixed(1) + ' ' + u[i] }

async function onImport() {
  if (!importForm.name.trim()) { ElMessage.warning('请输入名称'); return }
  loading.value = true
  try {
    let fileData = null, fileName = importForm.fileName
    if (importMode.value === 'paste' && pasteText.value.trim()) {
      // Blob → FileReader → base64（兼容中文）
      const blob = new Blob([pasteText.value], { type: 'text/csv' })
      fileData = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(blob)
      })
      fileName = 'pasted.csv'
    } else if (rawFile.value) {
      fileData = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(rawFile.value)
      })
    }
    if (fileData) {
      await importDatasetFile({ name: importForm.name, fileName, fileData, fileSize: importForm.fileSize || fileData.length, itemCount: 0 })
    } else {
      await importDataset({ name: importForm.name, fileName: importForm.fileName, fileSize: importForm.fileSize, itemCount: importForm.itemCount })
    }
    ElMessage.success('已导入')
    visible.value = false
    emit('imported')
  } catch (e) { ElMessage.error(e.message || '导入失败') }
  finally { loading.value = false }
}

function onParsePaste() {
  if (!pasteText.value.trim()) { ElMessage.warning('请粘贴数据'); return }
  const lines = pasteText.value.trim().split('\n')
  importForm.value.itemCount = Math.min(Math.max(lines.length, 1), 500)
  importForm.value.fileName = '粘贴数据'
  importStep.value = 1
}
</script>

<style scoped>
.import-steps { margin-bottom: 12px; }
.drop-zone { border: 1.5px dashed #c0c4cc; border-radius: 8px; padding: 36px 0; text-align: center; cursor: pointer; transition: border-color .2s; }
.drop-zone:hover { border-color: #409eff; }
.file-sel { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 12px; background: #f0f9eb; border-radius: 4px; font-size: 13px; color: #67c23a; }
</style>
