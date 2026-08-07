<template>
  <el-dialog v-model="visible" title="一键导入任务" width="750px" @closed="resetImportTasks">
    <el-tabs v-model="importTab">
      <el-tab-pane label="上传文件" name="file">
        <div class="import-header"><span style="color:#909399;font-size:13px">支持 CSV/TXT</span><el-button size="small" text type="primary" @click="downloadTaskTemplate">下载CSV模板</el-button></div>
        <el-upload drag :limit="1" :auto-upload="false" :on-change="handleImportFile" :file-list="importFileList" accept=".csv,.txt">
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件或<em>点击上传</em></div>
        </el-upload>
      </el-tab-pane>
      <el-tab-pane label="粘贴数据" name="text">
        <el-alert type="info" :closable="false" style="margin-bottom:12px"><template #title>任务名称,标注类型,样本数量,截止时间,标注规范</template></el-alert>
        <el-input v-model="importTasksText" type="textarea" :rows="10" placeholder="示例-点云,ND001,3D点云标注,10000,2026-09-30," />
        <el-button style="margin-top:12px" type="primary" :disabled="!importTasksText.trim()" @click="parseImportTasksText">解析数据</el-button>
      </el-tab-pane>
    </el-tabs>
    <template v-if="importPreview.length">
      <div class="import-preview">
        <p>共 <b>{{ importPreview.length }}</b> 条</p>
        <el-table :data="importPreview" border max-height="260" size="small">
          <el-table-column label="任务名称" prop="taskName" />
          <el-table-column label="标注类型" prop="annotateType" width="110" />
          <el-table-column label="样本量" prop="sampleCount" width="80" />
          <el-table-column label="截止" prop="deadline" width="110" />
        </el-table>
        <div class="import-actions">
          <el-button @click="resetImportTasks">重选</el-button>
          <el-button type="primary" :loading="loading" @click="submitImportTasks">一键导入</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { importProjectTasksApi, importProjectTasksFileApi } from '@/api/projects'
import { parseTaskLines } from '@/utils/csv'

const emit = defineEmits(['imported'])

const visible = ref(false)
const loading = ref(false)
const importingProjectId = ref(null)
const importTab = ref('file')
const importTasksText = ref('')
const importFileList = ref([])
const importPreview = ref([])

const resetImportTasks = () => { importTasksText.value = ''; importFileList.value = []; importPreview.value = [] }

const open = (proj) => { resetImportTasks(); importingProjectId.value = proj.id; importTab.value = 'file'; visible.value = true }
defineExpose({ open })

const handleImportFile = (file) => {
  const raw = file.raw || file
  importFileList.value = [file]
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1]
    loading.value = true
    try {
      const json = await importProjectTasksFileApi(importingProjectId.value, { fileName: raw.name, fileData: base64 })
      ElMessage.success(`导入 ${json.data.imported} 条任务`)
      visible.value = false
      emit('imported')
    } catch { ElMessage.error('导入失败') }
    finally { loading.value = false }
  }
  reader.readAsDataURL(raw)
}

const parseImportTasksText = () => { importPreview.value = parseTaskLines(importTasksText.value) }

const downloadTaskTemplate = () => {
  const BOM = '\uFEFF'
  const content = BOM + '任务名称,标注类型,样本数量,截止时间,标注规范\n示例-点云,3D点云标注,10000,2026-09-30,\n示例-2D框,2D拉框,5000,2026-10-15,'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = '任务导入模板.csv'; a.click()
  URL.revokeObjectURL(url)
}

const submitImportTasks = async () => {
  if (!importPreview.value.length) return
  loading.value = true
  try {
    const { data } = await importProjectTasksApi(importingProjectId.value, importPreview.value)
    ElMessage.success(`导入 ${data.imported} 条任务`)
    visible.value = false
    emit('imported')
  } finally { loading.value = false }
}
</script>

<style scoped>
.import-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.import-preview { margin-top: 16px; padding-top: 12px; border-top: 1px solid #ebeef5; }
.import-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
</style>
