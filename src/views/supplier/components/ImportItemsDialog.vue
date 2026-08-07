<template>
  <el-dialog v-model="visible" title="导入明细" width="650px" @closed="reset">
    <div style="margin-bottom:12px;font-size:13px;color:#606266" v-if="taskName">
      导入到：<b>{{ taskName }}</b>
    </div>
    <el-tabs>
      <el-tab-pane label="上传文件" name="file">
        <div class="import-header"><span style="color:#909399;font-size:13px">支持CSV/TXT文件</span><el-button size="small" text type="primary" @click="downloadItemsTemplate">下载模板</el-button></div>
        <el-upload drag :limit="1" :auto-upload="false" :on-change="handleImportItemsFile" :file-list="fileList" accept=".csv,.txt,.xlsx,.xls">
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽CSV文件或<em>点击上传</em></div>
        </el-upload>
      </el-tab-pane>
      <el-tab-pane label="粘贴数据" name="text">
        <el-input v-model="text" type="textarea" :rows="8" placeholder="明细名称,数据类型,标注人,标注状态,备注,数据上传路径&#10;样本-001,图像,张三,annotated,,/data/upload/a&#10;样本-002,点云,李四,pending,,/data/upload/b" />
        <el-button style="margin-top:12px" type="primary" :disabled="!text.trim()" @click="preview=parseItemsLines(text)">解析</el-button>
      </el-tab-pane>
    </el-tabs>
    <template v-if="preview.length">
      <div class="import-preview"><p>共 <b>{{ preview.length }}</b> 条</p>
        <el-table :data="preview" border max-height="260" size="small">
          <el-table-column label="明细名称" prop="itemName" />
          <el-table-column label="数据类型" prop="dataType" width="80" />
          <el-table-column label="标注人" prop="annotator" width="80" />
          <el-table-column label="标注状态" width="90"><template #default="s">{{ ITEM_STATUS_MAP[s.row.status] || s.row.status }}</template></el-table-column>
          <el-table-column label="备注" prop="failReason" width="120" />
          <el-table-column label="数据上传路径" prop="uploadPath" min-width="150" show-overflow-tooltip />
        </el-table>
        <div class="import-actions"><el-button @click="preview=[];fileList=[]">重选</el-button><el-button type="primary" :loading="loading" @click="submitImportItems">导入</el-button></div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { importTaskItemsApi, importTaskItemsFileApi } from '@/api/items'
import { ITEM_STATUS_MAP } from '@/utils/constants'
import { parseItemsLines } from '@/utils/csv'

const emit = defineEmits(['imported'])

const visible = ref(false)
const loading = ref(false)
const taskId = ref(null)
const taskName = ref('')
const text = ref('')
const preview = ref([])
const fileList = ref([])

const reset = () => { text.value = ''; preview.value = []; fileList.value = [] }

const open = (taskRow) => {
  reset()
  taskId.value = taskRow ? taskRow.id : null
  taskName.value = taskRow?.taskName || ''
  visible.value = true
}
defineExpose({ open })

const handleImportItemsFile = (file) => {
  const raw = file.raw || file
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1]
    loading.value = true
    try {
      const json = await importTaskItemsFileApi(taskId.value, { fileName: raw.name, fileData: base64 })
      ElMessage.success(`导入 ${json.data.imported} 条明细`)
      visible.value = false
      emit('imported')
    } catch { ElMessage.error('导入失败') }
    finally { loading.value = false }
  }
  reader.readAsDataURL(raw)
}

const submitImportItems = async () => {
  if (!preview.value.length) return
  loading.value = true
  try {
    const { data } = await importTaskItemsApi(taskId.value, { rows: preview.value })
    ElMessage.success(`导入 ${data.imported} 条明细`)
    visible.value = false
    emit('imported')
  } catch { ElMessage.error('导入失败') } finally { loading.value = false }
}

const downloadItemsTemplate = () => {
  const BOM = '\uFEFF'
  const content = BOM + '明细名称,数据类型,标注人,标注状态,备注,数据上传路径\n样本-001,图像,张三,annotated,,/data/upload/a\n样本-002,点云,李四,pending,,/data/upload/b\n样本-003,图像,王五,failed,图像模糊,/data/upload/c'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = '明细导入模板.csv'; a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.import-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.import-preview { margin-top: 16px; padding-top: 12px; border-top: 1px solid #ebeef5; }
.import-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
</style>
