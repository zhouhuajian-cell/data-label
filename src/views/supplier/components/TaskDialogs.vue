<template>
  <!-- 编辑项目 -->
  <el-dialog v-model="editProjectVisible" title="编辑项目" width="600px">
    <el-form ref="editProjectFormRef" :model="editProjectForm" :rules="editProjectRules" label-width="90px">
      <el-form-item label="项目名称" prop="name"><el-input v-model="editProjectForm.name" /></el-form-item>
      <el-form-item label="标注类型" prop="annotateType">
        <el-select v-model="editProjectForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select>
      </el-form-item>
      <el-form-item label="截止时间"><el-date-picker v-model="editProjectForm.deadline" type="date" style="width:100%" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item label="项目描述"><el-input v-model="editProjectForm.description" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="项目模板"><el-input v-model="editProjectForm.template" placeholder="标注模板/模板说明（选填）" /></el-form-item>
      <el-form-item label="数据上传路径"><el-input v-model="editProjectForm.uploadPath" placeholder="数据上传路径（选填）" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editProjectVisible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submitEditProject">保存</el-button>
    </template>
  </el-dialog>

  <!-- 编辑任务 -->
  <el-dialog v-model="editTaskVisible" title="编辑任务" width="560px">
    <el-form ref="editTaskFormRef" :model="editTaskForm" :rules="editTaskRules" label-width="100px">
      <el-form-item label="任务名称" prop="taskName"><el-input v-model="editTaskForm.taskName" /></el-form-item>
      <el-form-item label="标注类型" prop="annotateType"><el-select v-model="editTaskForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></el-form-item>
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="样本数量"><el-input-number v-model="editTaskForm.sampleCount" :min="1" style="width:100%" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="单价"><el-input-number v-model="editTaskForm.unitPrice" :min="0" :step="0.05" :precision="2" style="width:100%" /></el-form-item></el-col>
      </el-row>
      <el-form-item label="截止时间"><el-date-picker v-model="editTaskForm.deadline" type="datetime" style="width:100%" value-format="YYYY-MM-DD HH:mm" /></el-form-item>
      <el-form-item label="标注规范"><el-input v-model="editTaskForm.qaStandard" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editTaskVisible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submitEditTask">保存</el-button>
    </template>
  </el-dialog>

  <!-- 派发（单条/批量） -->
  <el-dialog v-model="dispatchTaskVisible" :title="dispatchForm.taskIds.length > 1 ? '批量派发任务' : '派发任务'" width="500px">
    <el-form ref="dispatchTaskFormRef" :model="dispatchForm" :rules="{ supplierId: [{ required: true, message: '请选择供应商', trigger: 'change' }] }" label-width="80px">
      <el-form-item label="任务">
        <span v-if="dispatchForm.taskIds.length === 1">{{ dispatchForm.taskName }}</span>
        <el-tag v-else type="warning">已选 {{ dispatchForm.taskIds.length }} 个任务</el-tag>
      </el-form-item>
      <el-form-item label="供应商" prop="supplierId">
        <el-select v-model="dispatchForm.supplierId" placeholder="选择供应商" style="width:100%" @focus="loadSuppliers">
          <el-option v-for="s in supplierList" :key="s.id" :label="s.name + ' | 质量分' + s.qualityScore" :value="s.id" />
        </el-select>
      </el-form-item>
      <div v-if="dispatchSelectedSupplier" class="supplier-info">
        <div class="si-row"><span>供应商</span><b>{{ dispatchSelectedSupplier.name }}</b></div>
        <div class="si-row"><span>联系人</span>{{ dispatchSelectedSupplier.contact }}</div>
        <div class="si-row"><span>产能(条/月)</span>{{ dispatchSelectedSupplier.capacity?.toLocaleString() }}</div>
        <div class="si-row"><span>质量分</span><b :style="{color: dispatchSelectedSupplier.qualityScore >= 90 ? '#67c23a' : '#e6a23c'}">{{ dispatchSelectedSupplier.qualityScore }}</b></div>
        <div class="si-row"><span>在执任务</span>{{ dispatchSelectedSupplier.activeTaskCount }}</div>
      </div>
      <el-form-item label="立即开工" style="margin-top:12px">
        <el-switch v-model="dispatchForm.immediateStart" active-text="派发后直接进入标注" />
      </el-form-item>
      <el-form-item label="QA抽检率">
        <el-slider v-model="dispatchForm.qaSamplingRate" :min="0.1" :max="1" :step="0.1" :format-tooltip="(v) => (v*100).toFixed(0) + '%'" style="width:100%" />
        <span style="color:#909399;font-size:12px">{{ (dispatchForm.qaSamplingRate * 100).toFixed(0) }}%（未抽中的自动通过）</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dispatchTaskVisible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="confirmDispatch">确认派发</el-button>
    </template>
  </el-dialog>

  <!-- 验收 -->
  <el-dialog v-model="reviewTaskVisible" title="验收" width="480px">
    <el-form ref="reviewFormRef" :model="reviewForm" :rules="reviewRules" label-width="90px">
      <el-form-item label="任务">{{ reviewForm.taskName }}</el-form-item>
      <el-form-item label="结果" prop="pass">
        <el-radio-group v-model="reviewForm.pass"><el-radio-button :value="true">通过</el-radio-button><el-radio-button :value="false">驳回</el-radio-button></el-radio-group>
      </el-form-item>
      <el-form-item label="分数" prop="score"><el-input-number v-model="reviewForm.score" :min="0" :max="100" style="width:100%" /></el-form-item>
      <el-form-item label="意见" prop="comment"><el-input v-model="reviewForm.comment" type="textarea" :rows="2" :placeholder="reviewForm.pass ? '选填' : '驳回原因必填（至少5字）'" /></el-form-item>
      <el-form-item v-if="!reviewForm.pass" label="驳回分类" prop="rejectReason">
        <el-select v-model="reviewForm.rejectReason" placeholder="选择驳回原因" style="width:100%">
          <el-option v-for="t in REJECT_ERROR_TYPES" :key="t.value" :label="t.label" :value="t.label" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="reviewTaskVisible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="confirmReview">提交</el-button>
    </template>
  </el-dialog>

  <!-- 添加任务 -->
  <el-dialog v-model="addTaskVisible" title="添加任务" width="560px" @closed="addTaskFormRef?.resetFields()">
    <el-form ref="addTaskFormRef" :model="addTaskForm" :rules="addTaskRules" label-width="110px">
      <el-form-item label="任务名称" prop="taskName"><el-input v-model="addTaskForm.taskName" placeholder="如：Batch02-路口场景" /></el-form-item>
      <el-form-item label="数据上传路径" prop="uploadPath"><el-input v-model="addTaskForm.uploadPath" placeholder="请输入数据上传路径" /></el-form-item>
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="标注类型" prop="annotateType"><el-select v-model="addTaskForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="单价"><el-input-number v-model="addTaskForm.unitPrice" :min="0" :step="0.05" :precision="2" style="width:100%" /></el-form-item></el-col>
      </el-row>
      <el-form-item label="样本数量"><el-input-number v-model="addTaskForm.sampleCount" :min="0" style="width:100%" /></el-form-item>
      <el-form-item label="截止时间"><el-date-picker v-model="addTaskForm.deadline" type="datetime" style="width:100%" value-format="YYYY-MM-DD HH:mm" /></el-form-item>
      <el-form-item label="标注规范"><el-input v-model="addTaskForm.qaStandard" type="textarea" :rows="2" placeholder="标注规范要求" /></el-form-item>
      <el-form-item label="数据包"><el-upload :auto-upload="false" :limit="1" :on-change="onAddTaskFileChange" accept=".zip,.tar,.gz,.7z"><el-button size="small" :icon="Upload">{{ addTaskFile ? addTaskFile.name : '选择数据包' }}</el-button></el-upload></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="addTaskVisible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submitAddTask">确认添加</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { ANNOTATE_TYPES, REJECT_ERROR_TYPES } from '@/utils/constants'
import { updateProjectApi } from '@/api/projects'
import { createTaskApi, dispatchTaskApi, getSupplierListApi, updateTaskApi, reviewTaskApi } from '@/api/tasks'

const props = defineProps({ supplierList: { type: Array, default: () => [] } })
const emit = defineEmits(['project-saved', 'task-saved', 'dispatched', 'reviewed'])

const loading = ref(false)
const annotateTypes = ANNOTATE_TYPES
const loadSuppliers = async () => { if (!props.supplierList.length) try { const { data } = await getSupplierListApi(); props.supplierList.splice(0, props.supplierList.length, ...(data || [])) } catch {} }

// ===== 编辑项目 =====
const editProjectVisible = ref(false)
const editProjectFormRef = ref(null)
const editProjectForm = reactive({ id: null, name: '', annotateType: '', deadline: '', description: '', template: '', uploadPath: '' })
const editProjectRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }]
}
const openEditProject = (proj) => {
  Object.assign(editProjectForm, { id: proj.id, name: proj.name, annotateType: proj.annotateType, deadline: proj.deadline === '-' ? '' : proj.deadline, description: proj.description, template: proj.template || '', uploadPath: proj.uploadPath || '' })
  editProjectVisible.value = true
}
const submitEditProject = async () => {
  try { await editProjectFormRef.value.validate() } catch { return }
  loading.value = true
  try {
    await updateProjectApi(editProjectForm.id, editProjectForm)
    ElMessage.success('项目已更新')
    editProjectVisible.value = false
    emit('project-saved')
  } finally { loading.value = false }
}

// ===== 添加任务 =====
const editingProjectId = ref(null)
const addTaskVisible = ref(false)
const addTaskFormRef = ref(null)
const addTaskFile = ref(null)
const addTaskForm = reactive({ taskName: '', uploadPath: '', annotateType: '', sampleCount: null, unitPrice: 0.1, deadline: '', qaStandard: '' })
const addTaskRules = { taskName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }], annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }], uploadPath: [{ required: true, message: '请填写数据上传路径', trigger: 'blur' }] }
const openAddTask = (proj) => {
  editingProjectId.value = proj.id
  addTaskForm.taskName = ''; addTaskForm.uploadPath = ''; addTaskForm.annotateType = proj.annotateType || '2D拉框'
  addTaskForm.sampleCount = null; addTaskForm.unitPrice = 0.1; addTaskForm.deadline = proj.deadline || ''; addTaskForm.qaStandard = ''
  addTaskFile.value = null
  addTaskVisible.value = true
}
const onAddTaskFileChange = (file) => { addTaskFile.value = file.raw || file }
const submitAddTask = async () => {
  try { await addTaskFormRef.value.validate() } catch { return }
  loading.value = true
  try {
    const body = { ...addTaskForm, projectId: editingProjectId.value }
    if (addTaskFile.value) {
      const b64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(addTaskFile.value) })
      body.dataPackage = { fileName: addTaskFile.value.name, data: b64 }
    }
    await createTaskApi(body)
    ElMessage.success('任务已添加')
    addTaskVisible.value = false; addTaskFile.value = null
    emit('task-saved')
  } finally { loading.value = false }
}

// ===== 编辑任务 =====
const editTaskVisible = ref(false)
const editTaskFormRef = ref(null)
const editTaskForm = reactive({ id: null, taskName: '', annotateType: '', sampleCount: null, unitPrice: 0.1, deadline: '', qaStandard: '' })
const editTaskRules = { taskName: [{ required: true, message: '请输入任务名称' }], annotateType: [{ required: true, message: '请选择类型' }] }
const editTask = (row) => {
  Object.assign(editTaskForm, { id: row.id, taskName: row.taskName, annotateType: row.annotateType, sampleCount: row.sampleCount, unitPrice: row.unitPrice || 0.1, deadline: row.deadline, qaStandard: row.qaStandard?.replace(/<[^>]*>/g, '') || '' })
  editTaskVisible.value = true
}
const submitEditTask = async () => {
  try { await editTaskFormRef.value.validate() } catch { return }
  loading.value = true
  try {
    await updateTaskApi(editTaskForm.id, editTaskForm)
    ElMessage.success('已更新')
    editTaskVisible.value = false
    emit('task-saved')
  } finally { loading.value = false }
}

// ===== 派发 =====
const dispatchTaskVisible = ref(false)
const dispatchTaskFormRef = ref(null)
const dispatchForm = reactive({ taskIds: [], taskName: '', supplierId: null, immediateStart: true, qaSamplingRate: 0.2 })
const dispatchSelectedSupplier = computed(() => props.supplierList.find(s => s.id === dispatchForm.supplierId))
const dispatchSingle = (row) => {
  dispatchForm.taskIds = [row.id]; dispatchForm.taskName = row.taskName
  dispatchForm.supplierId = null; dispatchForm.immediateStart = true; dispatchForm.qaSamplingRate = 0.2
  dispatchTaskVisible.value = true
}
const openBatchDispatch = (rows) => {
  if (!rows.length) { ElMessage.warning('请先勾选任务'); return }
  dispatchForm.taskIds = rows.map(r => r.id)
  dispatchForm.taskName = ''; dispatchForm.supplierId = null; dispatchForm.immediateStart = true; dispatchForm.qaSamplingRate = 0.2
  dispatchTaskVisible.value = true
}
const confirmDispatch = async () => {
  try { await dispatchTaskFormRef.value.validate() } catch { return }
  const sup = props.supplierList.find(s => s.id === dispatchForm.supplierId)
  const count = dispatchForm.taskIds.length
  try {
    await ElMessageBox.confirm(
      `确认将${count > 1 ? ` ${count} 个` : ''}任务派发给【${sup?.name || '指定供应商'}】吗？\n派发后任务将锁定，不可修改。`,
      '派发确认', { confirmButtonText: '确认派发', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  loading.value = true
  try {
    let done = 0
    for (const id of dispatchForm.taskIds) {
      try { await dispatchTaskApi(id, { supplierId: dispatchForm.supplierId, immediateStart: dispatchForm.immediateStart, qaSamplingRate: dispatchForm.qaSamplingRate }); done++ } catch {}
    }
    ElMessage.success(`已派发 ${done}/${dispatchForm.taskIds.length} 条任务`)
    dispatchTaskVisible.value = false
    emit('dispatched')
  } finally { loading.value = false }
}

// ===== 验收 =====
const reviewTaskVisible = ref(false)
const reviewFormRef = ref(null)
const reviewForm = reactive({ taskId: null, taskName: '', pass: true, score: null, comment: '', rejectReason: '' })
const reviewRules = {
  score: [{ required: true, message: '请输入分数' }],
  rejectReason: [{ validator: (r, v, cb) => { if (!reviewForm.pass && !v) cb(new Error('请选择驳回分类')); else cb() }, trigger: 'change' }],
  comment: [{ validator: (r, v, cb) => { if (!reviewForm.pass && (!v || v.length < 5)) cb(new Error('驳回需填写原因（至少5字）')); else cb() }, trigger: 'blur' }]
}
const reviewSingle = (row) => {
  reviewForm.taskId = row.id; reviewForm.taskName = row.taskName; reviewForm.pass = true; reviewForm.score = null; reviewForm.comment = ''; reviewForm.rejectReason = ''
  reviewTaskVisible.value = true
}
const confirmReview = async () => {
  try { await reviewFormRef.value.validate() } catch { return }
  loading.value = true
  try {
    await reviewTaskApi(reviewForm.taskId, { pass: reviewForm.pass, score: reviewForm.score, comment: reviewForm.comment, rejectReason: reviewForm.rejectReason })
    ElMessage.success(reviewForm.pass ? '验收通过' : '已驳回')
    reviewTaskVisible.value = false
    emit('reviewed')
  } finally { loading.value = false }
}

defineExpose({ openEditProject, openAddTask, editTask, dispatchSingle, openBatchDispatch, reviewSingle })
</script>

<style scoped>
.supplier-info { border: 1px solid #ebeef5; border-radius: 6px; padding: 12px; margin-top: 8px; }
.si-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.si-row span { color: #909399; }
</style>
