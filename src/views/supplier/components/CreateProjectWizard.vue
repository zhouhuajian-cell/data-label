<template>
  <el-dialog v-model="createVisible" title="新建项目" width="860px" :close-on-click-modal="false" @closed="resetCreate">
    <el-steps :active="createStep" align-center finish-status="success" class="create-steps">
      <el-step title="项目信息" />
      <el-step title="任务明细" />
    </el-steps>

    <!-- 步骤1：项目信息 -->
    <el-form v-show="createStep === 0" ref="step1FormRef" :model="createForm" :rules="createProjectRules" label-width="90px" style="margin-top:20px">
      <el-form-item label="项目名称" prop="name"><el-input v-model="createForm.name" placeholder="请输入项目名称" /></el-form-item>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="标注类型" prop="annotateType">
            <el-select v-model="createForm.annotateType" placeholder="选择类型" style="width:100%">
              <el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="截止时间"><el-date-picker v-model="createForm.deadline" type="date" style="width:100%" value-format="YYYY-MM-DD" /></el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="项目描述"><el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="项目描述（选填）" /></el-form-item>
      <el-form-item label="项目模板"><el-input v-model="createForm.template" placeholder="标注模板/模板说明（选填）" /></el-form-item>
      <el-form-item label="数据上传路径"><el-input v-model="createForm.uploadPath" placeholder="数据上传路径（选填）" /></el-form-item>
      <el-form-item label="绑定数据集">
        <el-radio-group v-model="createForm.bindMode" size="small" style="margin-bottom:8px">
          <el-radio-button value="select">选择已有</el-radio-button>
          <el-radio-button value="upload">上传新数据</el-radio-button>
        </el-radio-group>
        <el-select v-if="createForm.bindMode==='select'" v-model="createForm.datasetId" placeholder="选择清洗数据集" clearable style="width:100%" @focus="loadGovernanceDatasets">
          <el-option v-for="ds in governanceDatasets" :key="ds.id" :label="ds.name + ' | ' + ds.itemCount + '条'" :value="ds.id" />
        </el-select>
        <div v-else class="upload-row">
          <el-upload drag :auto-upload="false" :on-change="onProjectFileChange" :limit="1" accept=".zip,.csv,.xlsx,.json,.jsonl" style="width:100%">
            <el-icon size="32"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽数据包或<em>点击上传</em></div>
            <template #tip><div class="el-upload__tip">支持 zip / csv / xlsx / json</div></template>
          </el-upload>
          <div v-if="uploadForm.fileName" class="file-sel" style="margin-top:8px;padding:8px 12px;background:#f0f9eb;border-radius:4px;font-size:13px;color:#67c23a;display:flex;align-items:center;gap:6px">
            <el-icon><Document /></el-icon>已选择：{{ uploadForm.fileName }}（{{ fmtSize(uploadForm.fileSize) }}）
          </div>
          <el-input v-if="uploadForm.fileName" v-model="uploadForm.datasetName" placeholder="数据集名称" style="margin-top:8px" />
          <el-input-number v-if="uploadForm.fileName" v-model="uploadForm.itemCount" :min="1" :max="500" style="margin-top:8px;width:100%" />
        </div>
      </el-form-item>
    </el-form>

    <!-- 步骤2：任务明细 -->
    <div v-show="createStep === 1" style="margin-top:20px">
      <div class="step2-toolbar">
        <span class="step2-tip">为项目添加任务（至少 1 个）</span>
        <el-button size="small" type="primary" text :icon="Plus" @click="addTaskRow">手动添加</el-button>
        <el-button v-if="createForm.bindMode==='select' && createForm.datasetId" size="small" type="success" :icon="Connection" @click="autoSplitTasks">自动拆分</el-button>
        <el-upload :show-file-list="false" :auto-upload="false" :on-change="onTaskExcelImport" accept=".xlsx,.xls,.csv" style="display:inline-flex">
          <el-button size="small" type="warning" text :icon="Upload">导入Excel</el-button>
        </el-upload>
      </div>
      <el-table :data="createForm.tasks" border size="small" max-height="300">
        <el-table-column label="任务名称" min-width="150"><template #default="s"><el-input v-model="s.row.taskName" placeholder="任务名称" size="small" /></template></el-table-column>
        <el-table-column label="数据上传路径" min-width="150"><template #default="s"><el-input v-model="s.row.uploadPath" placeholder="数据上传路径" size="small" /></template></el-table-column>
        <el-table-column label="类型" width="115"><template #default="s"><el-select v-model="s.row.annotateType" size="small"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></template></el-table-column>
        <el-table-column label="样本量" width="85"><template #default="s"><el-input-number v-model="s.row.sampleCount" :min="0" size="small" controls-position="right" style="width:75px" /></template></el-table-column>
        <el-table-column label="单价" width="80"><template #default="s"><el-input-number v-model="s.row.unitPrice" :min="0" :step="0.05" :precision="2" size="small" controls-position="right" style="width:70px" /></template></el-table-column>
        <el-table-column label="截止" width="125"><template #default="s"><el-date-picker v-model="s.row.deadline" type="date" size="small" style="width:115px" value-format="YYYY-MM-DD" /></template></el-table-column>
        <el-table-column label="操作" width="55"><template #default="s"><el-button text size="small" type="danger" :icon="Delete" @click="removeTaskRow(s.$index)" /></template></el-table-column>
      </el-table>
      <div class="create-total">合计 {{ createForm.tasks.length }} 个任务 · 预估总额 ¥{{ createTotalPrice }}</div>
    </div>

    <!-- 步骤2 底部提示：创建后需导入明细才能派发 -->
    <el-alert v-if="createStep === 1" type="warning" :closable="false" style="margin-top:12px">
      <template #title>任务创建后需先「导入明细」才能派发给供应商</template>
    </el-alert>

    <template #footer>
      <el-button v-if="createStep > 0" @click="createStep--">上一步</el-button>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button v-if="createStep < 1" type="primary" @click="nextStep">下一步</el-button>
      <el-button v-else type="primary" :loading="actionLoading" @click="submitCreate">创建项目</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Upload, Delete, Connection, UploadFilled, Document } from '@element-plus/icons-vue'
import { ANNOTATE_TYPES } from '@/utils/constants'
import { createProjectApi, splitProjectApi, parseProjectExcelApi } from '@/api/projects'
import { createTaskApi } from '@/api/tasks'
import { fetchGovernedDatasets, importDataset, previewSplitApi } from '@/api/governance'

const emit = defineEmits(['created'])

const actionLoading = ref(false)
const createVisible = ref(false)
const createStep = ref(0)
const step1FormRef = ref(null)
const createForm = reactive({ name: '', annotateType: '', deadline: '', description: '', template: '', uploadPath: '', datasetId: null, bindMode: 'select', tasks: [] })
const uploadForm = reactive({ fileName: '', fileSize: 0, datasetName: '', itemCount: 30 })
const createProjectRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }]
}
const annotateTypes = ANNOTATE_TYPES
const governanceDatasets = ref([])
const createTotalPrice = computed(() => createForm.tasks.reduce((sum, t) => sum + (t.sampleCount || 0) * (t.unitPrice || 0), 0).toFixed(2))

const addTaskRow = () => createForm.tasks.push({ taskName: '', uploadPath: createForm.uploadPath || '', annotateType: createForm.annotateType || '2D拉框', sampleCount: 0, unitPrice: 0.1, deadline: createForm.deadline || '', qaStandard: '' })
const removeTaskRow = (i) => createForm.tasks.splice(i, 1)

const resetCreate = () => {
  createStep.value = 0
  step1FormRef.value?.resetFields()
  Object.assign(createForm, { name: '', annotateType: '', deadline: '', description: '', template: '', uploadPath: '', datasetId: null, bindMode: 'select', tasks: [] })
  Object.assign(uploadForm, { fileName: '', fileSize: 0, datasetName: '', itemCount: 30 })
}

const open = () => { resetCreate(); addTaskRow(); createVisible.value = true }
defineExpose({ open })

const loadGovernanceDatasets = async () => {
  if (governanceDatasets.value.length) return
  try {
    const { data } = await fetchGovernedDatasets()
    governanceDatasets.value = (data || []).filter(d => d.status === 'TAGGED')
  } catch {}
}

function onProjectFileChange(file) {
  const raw = file.raw || file
  uploadForm.fileName = raw.name
  uploadForm.fileSize = raw.size
  const m = (raw.name || '').match(/[-_](\d+)(?=\.\w+$)/)
  uploadForm.itemCount = m ? Math.min(Number(m[1]), 500) : 30
}

function fmtSize(b) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, s = b; while (s >= 1024 && i < 3) { s /= 1024; i++ } return s.toFixed(1) + ' ' + u[i] }

// Excel 导入 → 后端解析后填充任务明细
async function onTaskExcelImport(file) {
  const raw = file.raw || file
  try {
    const reader = new FileReader()
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => { const data = reader.result.split(',')[1]; resolve(data) }
      reader.onerror = reject
      reader.readAsDataURL(raw)
    })
    const { data, message } = await parseProjectExcelApi({ fileName: raw.name, fileData: base64 })
    if (!data?.tasks) { ElMessage.error(message || '解析失败'); return }
    const taskRows = data.tasks || []
    createForm.tasks = taskRows.map(t => ({ ...t, uploadPath: t.uploadPath || createForm.uploadPath || '' }))
    ElMessage.success(`已解析 ${taskRows.length} 条任务明细（列：${(data.columns || []).join('、')}）`)
  } catch (e) {
    ElMessage.error('解析失败：' + e.message)
  }
}

// 自动拆分：将绑定的数据集按每 N 张图拆分为任务
const autoSplitTasks = async () => {
  const itemsPerTask = 10
  try {
    const { data, message } = await previewSplitApi({ datasetId: createForm.datasetId, itemsPerTask })
    if (!data?.tasks) { ElMessage.error(message || '拆分失败'); return }
    const taskPreviews = data.tasks || []
    createForm.tasks = taskPreviews.map(t => ({
      taskName: t.taskName, annotateType: createForm.annotateType || '2D拉框',
      sampleCount: t.sampleCount, unitPrice: 0.1, deadline: createForm.deadline || '', qaStandard: '',
      uploadPath: t.uploadPath || createForm.uploadPath || ''
    }))
    ElMessage.success(`已按每 ${itemsPerTask} 张拆分 ${taskPreviews.length} 个任务`)
  } catch { ElMessage.error('自动拆分失败') }
}

const nextStep = async () => {
  if (createStep.value === 0) {
    try { await step1FormRef.value.validate() } catch { return }
  }
  if (createStep.value === 1) {
    const valid = createForm.tasks.filter(t => t.taskName.trim())
    if (!valid.length && !createForm.datasetId) { ElMessage.warning('请至少添加一个任务或绑定数据集并自动拆分'); return }
    const missing = valid.filter(t => !(t.uploadPath || '').trim())
    if (missing.length) { ElMessage.warning(`还有 ${missing.length} 个任务未填写数据上传路径`); return }
  }
  createStep.value++
}

const submitCreate = async () => {
  const validTasks = createForm.tasks.filter(t => t.taskName.trim())
  if (!validTasks.length && !createForm.datasetId && createForm.bindMode !== 'upload') { ElMessage.warning('请至少添加一个任务或绑定数据集'); return }
  if (createForm.bindMode === 'upload' && !uploadForm.fileName) { ElMessage.warning('请选择要上传的数据文件'); return }
  actionLoading.value = true
  try {
    let finalDatasetId = createForm.datasetId
    // 上传模式：先导入数据生成数据集
    if (createForm.bindMode === 'upload') {
      const { data: ds } = await importDataset({ name: uploadForm.datasetName || createForm.name + '_data', fileName: uploadForm.fileName, fileSize: uploadForm.fileSize, itemCount: uploadForm.itemCount })
      finalDatasetId = ds.id
      ElMessage.success('数据已导入，生成数据集 ' + ds.name)
    }
    const { data: project } = await createProjectApi({
      name: createForm.name, annotateType: createForm.annotateType,
      deadline: createForm.deadline, description: createForm.description,
      template: createForm.template, uploadPath: createForm.uploadPath,
      datasetId: finalDatasetId
    })
    // 如果绑定了数据集 → 调用拆分 API（自动创建任务+复制数据）
    if (createForm.datasetId) {
      const splitJson = await splitProjectApi(project.id, { itemsPerTask: 10 })
      if (splitJson.code === 0) {
        const createdTasks = splitJson.data.tasks || []
        ElMessage.success(`项目创建成功，自动拆分 ${createdTasks.length} 个任务，共 ${splitJson.data.totalItems} 条数据`)
      }
    } else {
      // 手动添加的任务
      for (const task of validTasks) {
        await createTaskApi({ ...task, projectId: project.id })
      }
      ElMessage.success(`项目创建成功，共 ${validTasks.length} 条任务`)
    }
    createVisible.value = false
    emit('created')
  } finally { actionLoading.value = false }
}
</script>

<style scoped>
.create-steps { margin-bottom: 8px; }
.step2-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.step2-tip { font-size: 13px; color: #606266; }
.create-total { margin-top: 8px; font-size: 13px; color: #909399; }
.supplier-info { border: 1px solid #ebeef5; border-radius: 6px; padding: 12px; margin-top: 8px; }
.si-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.si-row span { color: #909399; }
</style>
