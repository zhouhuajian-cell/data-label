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
          <el-form-item label="业务类型" prop="bizType">
            <el-select v-model="createForm.bizType" placeholder="选择业务类型" style="width:100%">
              <el-option label="数据闭环" value="数据闭环" />
              <el-option label="vslam" value="vslam" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="标注类型" prop="annotateType">
            <el-select v-model="createForm.annotateType" placeholder="选择类型" style="width:100%">
              <el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="截止时间"><el-date-picker v-model="createForm.deadline" type="date" style="width:100%" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item label="项目描述"><el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="项目描述（选填）" /></el-form-item>
    </el-form>

    <!-- 步骤2：任务明细 -->
    <div v-show="createStep === 1" style="margin-top:20px">
      <div class="step2-toolbar">
        <span class="step2-tip">为项目添加任务（至少 1 个）</span>
        <el-button size="small" type="primary" text :icon="Plus" @click="addTaskRow">手动添加</el-button>
        <el-upload :show-file-list="false" :auto-upload="false" :on-change="onTaskExcelImport" accept=".xlsx,.xls,.csv" style="display:inline-flex">
          <el-button size="small" type="warning" text :icon="Upload">导入Excel</el-button>
        </el-upload>
      </div>
      <el-table :data="createForm.tasks" border size="small" max-height="300">
        <el-table-column label="任务名称" min-width="150"><template #default="s"><el-input v-model="s.row.taskName" placeholder="任务名称" size="small" /></template></el-table-column>
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
import { Plus, Upload, Delete } from '@element-plus/icons-vue'
import { ANNOTATE_TYPES } from '@/utils/constants'
import { createProjectApi, parseProjectExcelApi } from '@/api/projects'
import { createTaskApi } from '@/api/tasks'

const emit = defineEmits(['created'])

const actionLoading = ref(false)
const createVisible = ref(false)
const createStep = ref(0)
const step1FormRef = ref(null)
const createForm = reactive({ name: '', bizType: '数据闭环', annotateType: '', deadline: '', description: '', tasks: [] })
const createProjectRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }]
}
const annotateTypes = ANNOTATE_TYPES
const createTotalPrice = computed(() => createForm.tasks.reduce((sum, t) => sum + (t.sampleCount || 0) * (t.unitPrice || 0), 0).toFixed(2))

const addTaskRow = () => createForm.tasks.push({ taskName: '', annotateType: createForm.annotateType || '2D拉框', sampleCount: 0, unitPrice: 0.1, deadline: createForm.deadline || '', qaStandard: '' })
const removeTaskRow = (i) => createForm.tasks.splice(i, 1)

const resetCreate = () => {
  createStep.value = 0
  step1FormRef.value?.resetFields()
  Object.assign(createForm, { name: '', bizType: '数据闭环', annotateType: '', deadline: '', description: '', tasks: [] })
}

const open = () => { resetCreate(); addTaskRow(); createVisible.value = true }
defineExpose({ open })

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
    createForm.tasks = taskRows.map(t => ({ ...t }))
    ElMessage.success(`已解析 ${taskRows.length} 条任务明细（列：${(data.columns || []).join('、')}）`)
  } catch (e) {
    ElMessage.error('解析失败：' + e.message)
  }
}

const nextStep = async () => {
  if (createStep.value === 0) {
    try { await step1FormRef.value.validate() } catch { return }
  }
  if (createStep.value === 1) {
    const valid = createForm.tasks.filter(t => t.taskName.trim())
    if (!valid.length) { ElMessage.warning('请至少添加一个任务'); return }
  }
  createStep.value++
}

const submitCreate = async () => {
  const validTasks = createForm.tasks.filter(t => t.taskName.trim())
  if (!validTasks.length) { ElMessage.warning('请至少添加一个任务'); return }
  actionLoading.value = true
  try {
    const { data: project } = await createProjectApi({
      name: createForm.name, annotateType: createForm.annotateType, bizType: createForm.bizType,
      deadline: createForm.deadline, description: createForm.description
    })
    for (const task of validTasks) {
      await createTaskApi({ ...task, projectId: project.id })
    }
    ElMessage.success(`项目创建成功，共 ${validTasks.length} 条任务`)
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
