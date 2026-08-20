<template>
  <div class="task-page">
    <el-card class="filter-card" shadow="never">
      <el-row :gutter="16">
        <el-col :span="6">
          <el-input v-model="searchKey" placeholder="搜索名称/ID" clearable @input="onSearchChange" @clear="onSearchChange" />
        </el-col>
        <el-col :span="4">
          <el-select v-model="stateFilter" placeholder="任务状态" clearable @change="onFilterChange">
            <el-option label="全部" value="" />
            <el-option v-for="(label, code) in TASK_STATE_MAP" :key="code" :label="label" :value="code" />
          </el-select>
        </el-col>
        <el-col :span="4">
          <el-select v-model="warnFilter" placeholder="预警级别" clearable @change="onFilterChange">
            <el-option label="超时任务" value="overdue" />
            <el-option label="即将超时" value="urgent" />
          </el-select>
        </el-col>
        <el-col :span="3"><el-button v-if="userRole === 1" type="primary" @click="$router.push('/supplier/projects')">项目管理</el-button></el-col>
      </el-row>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="table-header">
          <span>任务列表（共 {{ total }} 条）</span>
          <el-button v-if="userRole === 1" type="primary" @click="openCreate">新建任务</el-button>
        </div>
      </template>

      <el-table :data="displayList" border v-loading="loading" @selection-change="onSelectionChange" ref="tableRef">
        <el-table-column v-if="userRole === 1 || (userRole === 3 && displayList.some(t => stateSupportsBatch(t.state)))" type="selection" width="40" />
        <el-table-column label="预警" width="55">
          <template #default="scope">
            <el-tag v-if="warnLevel(scope.row) === 3" type="danger" size="small" effect="dark">超时</el-tag>
            <el-tag v-else-if="warnLevel(scope.row) === 2" type="warning" size="small" effect="dark">紧急</el-tag>
            <el-tag v-else-if="warnLevel(scope.row) === 1" type="" size="small">临近</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任务名称" prop="taskName" min-width="160" show-overflow-tooltip />
        <el-table-column label="类型" prop="annotateType" width="110" />
        <el-table-column label="供应商" prop="supplierName" width="100">
          <template #default="scope">{{ scope.row.supplierName || '-' }}</template>
        </el-table-column>
        <el-table-column label="样本量" prop="sampleCount" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="getStateType(scope.row.state)" size="small">{{ getStateText(scope.row.state) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="驳回" prop="rejectCount" width="60" />
        <el-table-column label="截止" prop="deadline" width="150" />
        <el-table-column label="操作" :width="userRole === 1 ? 320 : 240" fixed="right">
          <template #default="scope">
            <el-button text size="small" type="primary" @click="$router.push('/task/detail/' + scope.row.id)">详情</el-button>
            <template v-if="userRole === 1">
              <el-button v-if="['UNASSIGNED','REJECTED'].includes(scope.row.state)" text size="small" type="primary" @click="openDispatch(scope.row)">派发</el-button>
              <el-button v-if="scope.row.state === 'CLIENT_QA'" text size="small" type="success" @click="openReview(scope.row)">验收</el-button>
              <el-button v-if="scope.row.state === 'UNASSIGNED'" text size="small" type="warning" @click="openEdit(scope.row)">编辑</el-button>
              <el-button v-if="scope.row.state === 'UNASSIGNED'" text size="small" type="danger" @click="handleDelete(scope.row)">删除</el-button>
            </template>
            <template v-if="userRole === 3">
              <el-button v-if="scope.row.state === 'UNASSIGNED'" text size="small" type="primary" :loading="acceptingId === scope.row.id" @click="acceptTask(scope.row)">接单</el-button>
              <el-button v-if="scope.row.state === 'ANNOTATING'" text size="small" type="warning" @click="completeWork(scope.row)">完成作业</el-button>
              <el-button v-if="['VENDOR_QA','REJECTED'].includes(scope.row.state)" text size="small" type="success" @click="openDeliver(scope.row)">提交</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无任务" :image-size="80" /></template>
      </el-table>

      <div class="pagination-wrap">
        <el-button v-if="selectedRows.length" type="warning" @click="batchOp" style="margin-right:auto">{{ batchBtnText }}</el-button>
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50]" layout="total,sizes,prev,pager,next" :total="total" @current-change="loadTaskList" @size-change="onPageSizeChange" />
      </div>
    </el-card>

    <!-- delogs: create, edit, dispatch, review, deliver: same as before but updated state checks -->
    <el-dialog v-model="createVisible" title="新建标注任务" width="640px" @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="任务名称" prop="taskName"><el-input v-model="createForm.taskName" maxlength="100" /></el-form-item>
        <el-form-item label="标注类型" prop="annotateType">
          <el-select v-model="createForm.annotateType" style="width:100%">
            <el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="样本数量" prop="sampleCount"><el-input-number v-model="createForm.sampleCount" :min="1" :max="100000" style="width:100%" /></el-form-item>
        <el-form-item label="单价" prop="unitPrice"><el-input-number v-model="createForm.unitPrice" :min="0.01" :precision="2" style="width:100%" /></el-form-item>
        <el-form-item label="截止时间" prop="deadline"><el-date-picker v-model="createForm.deadline" type="datetime" style="width:100%" value-format="YYYY-MM-DD HH:mm" /></el-form-item>
        <el-form-item label="标注规范" prop="qaStandard"><el-input v-model="createForm.qaStandard" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="数据包">
          <el-upload drag :limit="1" :auto-upload="false" :on-change="handlePackageChange" :on-remove="handlePackageRemove" :file-list="packageFileList" accept=".zip,.tar.gz,.7z">
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽文件或<em>点击上传</em></div>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="createVisible = false">取消</el-button><el-button type="primary" :loading="actionLoading" @click="submitCreate">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑任务" width="640px">
      <el-form ref="editFormRef" :model="editForm" :rules="createRules" label-width="100px">
        <el-form-item label="任务名称" prop="taskName"><el-input v-model="editForm.taskName" /></el-form-item>
        <el-form-item label="标注类型" prop="annotateType"><el-select v-model="editForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></el-form-item>
        <el-form-item label="样本数量" prop="sampleCount"><el-input-number v-model="editForm.sampleCount" :min="1" style="width:100%" /></el-form-item>
        <el-form-item label="单价" prop="unitPrice"><el-input-number v-model="editForm.unitPrice" :min="0.01" :precision="2" style="width:100%" /></el-form-item>
        <el-form-item label="截止时间" prop="deadline"><el-date-picker v-model="editForm.deadline" type="datetime" style="width:100%" value-format="YYYY-MM-DD HH:mm" /></el-form-item>
        <el-form-item label="标注规范" prop="qaStandard"><el-input v-model="editForm.qaStandard" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editVisible = false">取消</el-button><el-button type="primary" :loading="actionLoading" @click="submitEdit">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="dispatchVisible" title="派发任务" width="480px">
      <el-form ref="dispatchFormRef" :model="dispatchForm" :rules="dispatchRules" label-width="80px">
        <el-form-item label="任务">{{ currentTask.taskName }}</el-form-item>
        <el-form-item label="供应商" prop="supplierId"><el-select v-model="dispatchForm.supplierId" placeholder="选择供应商" style="width:100%"><el-option v-for="s in supplierList" :key="s.id" :label="s.name + ' | 质量分' + s.qualityScore" :value="s.id" /></el-select></el-form-item>
        <el-checkbox v-model="dispatchForm.immediateStart">派发后立即开始作业</el-checkbox>
      </el-form>
      <template #footer><el-button @click="dispatchVisible = false">取消</el-button><el-button type="primary" :loading="actionLoading" @click="submitDispatch">确认</el-button></template>
    </el-dialog>

    <el-dialog v-model="reviewVisible" title="验收任务" width="560px">
      <el-form ref="reviewFormRef" :model="reviewForm" :rules="reviewRules" label-width="90px">
        <el-form-item label="任务">{{ currentTask.taskName }}</el-form-item>
        <el-form-item label="结果" prop="pass"><el-radio-group v-model="reviewForm.pass"><el-radio-button :value="true">通过</el-radio-button><el-radio-button :value="false">驳回整改</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="分数" prop="score"><el-input-number v-model="reviewForm.score" :min="0" :max="100" style="width:100%" /></el-form-item>
        <el-form-item v-if="!reviewForm.pass" label="驳回原因" prop="rejectReason">
          <el-select v-model="reviewForm.rejectReason" placeholder="选择原因分类" style="width:100%"><el-option v-for="r in REJECT_ERROR_TYPES" :key="r" :label="r" :value="r" /></el-select>
        </el-form-item>
        <el-form-item label="意见" prop="comment"><el-input v-model="reviewForm.comment" type="textarea" :rows="3" :placeholder="reviewForm.pass ? '验收意见' : '驳回详细说明'" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="reviewVisible = false">取消</el-button><el-button type="primary" :loading="actionLoading" @click="submitReview">提交</el-button></template>
    </el-dialog>

    <DeliverModal v-model:visible="deliverModalVisible" :task-info="currentTask" :items="currentTaskItems" @success="loadTaskList" />

    <!-- 批量提交成果弹窗：每个任务独立数据包 -->
    <el-dialog v-model="batchDeliverVisible" title="批量提交成果" width="640px" @closed="resetBatchDeliver">
      <el-alert type="info" :closable="false" style="margin-bottom:16px">
        <template #title>共 {{ selectedRows.length }} 个任务待提交，请为每个任务选择各自的数据包文件（必传）</template>
      </el-alert>
      <div class="batch-deliver-list">
        <div v-for="row in selectedRows" :key="row.id" class="batch-deliver-item">
          <div class="batch-deliver-info">
            <span class="task-name">{{ row.taskName }}</span>
            <el-tag size="small" :type="getStateType(row.state)">{{ getStateText(row.state) }}</el-tag>
          </div>
          <el-upload :limit="1" :auto-upload="false" :on-change="(f) => onBatchFileChange(row, f)" :on-remove="() => onBatchFileRemove(row)" :file-list="batchFileList[row.id] || []" accept=".zip,.tar.gz,.7z" class="batch-upload">
            <el-button size="small">{{ batchFiles[row.id] ? '重新选择' : '选择数据包' }}</el-button>
            <template #tip>
              <div v-if="batchFiles[row.id]" class="batch-file-name">{{ batchFiles[row.id].name }}（{{ (batchFiles[row.id].size / 1024).toFixed(1) }} KB）</div>
              <div v-else class="batch-file-name empty">支持 zip/tar.gz/7z，必传</div>
            </template>
          </el-upload>
        </div>
      </div>
      <el-form-item label="提交备注" style="margin-top:12px">
        <el-input v-model="batchDesc" type="textarea" :rows="2" placeholder="选填，任意字数" />
      </el-form-item>
      <template #footer>
        <el-button @click="batchDeliverVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" :disabled="!allBatchFilesReady" @click="confirmBatchSubmit">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import DeliverModal from '@/components/task/DeliverModal.vue'
import { acceptTaskApi, completeWorkApi, createTaskApi, dispatchTaskApi, getSupplierListApi, getTaskListApi, reviewTaskApi, updateTaskApi, deleteTaskApi, submitTaskApi } from '@/api/tasks'
import { TASK_STATE_MAP, getTaskStateText as getStateText, getTaskStateType as getStateType, calcWarningLevel, REJECT_ERROR_TYPES } from '@/utils/constants'

const route = useRoute(); const router = useRouter()
const userStore = useUserStore()
const userRole = computed(() => userStore.userInfo.roleType)

const loading = ref(false); const actionLoading = ref(false); const acceptingId = ref(null)
const searchKey = ref(''); const stateFilter = ref(''); const warnFilter = ref('')
const page = ref(1); const pageSize = ref(10); const total = ref(0)
const taskList = ref([]); const supplierList = ref([])
const selectedRows = ref([])
const tableRef = ref(null)

const annotateTypes = ['2D拉框', '3D点云标注', '语义分割', '车道线标注', 'Vslam', '数据闭环', 'CNN', 'AEB', 'OBJ']

const currentTask = ref({}); const currentTaskItems = ref([]); const deliverModalVisible = ref(false)
const batchDeliverVisible = ref(false); const batchFiles = reactive({}); const batchFileList = reactive({}); const batchDesc = ref('')
const createVisible = ref(false); const editVisible = ref(false); const dispatchVisible = ref(false); const reviewVisible = ref(false)

const createFormRef = ref(null); const editFormRef = ref(null); const dispatchFormRef = ref(null); const reviewFormRef = ref(null)
const createForm = reactive({ taskName: '', annotateType: '', sampleCount: null, unitPrice: null, deadline: '', qaStandard: '' })
const editForm = reactive({ id: null, taskName: '', annotateType: '', sampleCount: null, unitPrice: null, deadline: '', qaStandard: '' })
const dispatchForm = reactive({ supplierId: null, immediateStart: false })
const reviewForm = reactive({ pass: true, score: null, comment: '', rejectReason: '' })
const dataPackage = ref(null); const packageFileList = ref([])

const createRules = {
  taskName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }],
  sampleCount: [{ required: true, message: '请输入样本数量', trigger: 'blur' }],
  unitPrice: [{ required: true, message: '请输入单价', trigger: 'blur' }],
  deadline: [{ required: true, message: '请选择截止时间', trigger: 'change' }],
  qaStandard: [{ required: true, message: '请输入标注规范', trigger: 'blur' }]
}
const dispatchRules = { supplierId: [{ required: true, message: '请选择供应商', trigger: 'change' }] }
const reviewRules = {
  score: [{ required: true, message: '请输入分数', trigger: 'blur' }],
  rejectReason: [{ required: true, message: '请选择驳回原因', trigger: 'change' }],
  comment: [{ validator: (r, v, cb) => { if (!reviewForm.pass && (!v || v.length < 5)) cb(new Error('请填写详细原因')); else cb() }, trigger: 'blur' }]
}

const warnLevel = (row) => calcWarningLevel(row.deadline)?.level || 0

const displayList = computed(() => {
  if (warnFilter.value === 'overdue') return taskList.value.filter(t => calcWarningLevel(t.deadline)?.level === 3)
  if (warnFilter.value === 'urgent') return taskList.value.filter(t => calcWarningLevel(t.deadline)?.level >= 2)
  return taskList.value
})

const stateSupportsBatch = (state) => ['VENDOR_QA', 'REJECTED', 'CLIENT_QA'].includes(state)

const batchBtnText = computed(() => {
  if (!selectedRows.value.length) return ''
  const states = [...new Set(selectedRows.value.map(r => r.state))]
  if (states.every(s => s === 'VENDOR_QA')) return `批量提交(${selectedRows.value.length})`
  if (states.every(s => s === 'CLIENT_QA')) return `批量验收(${selectedRows.value.length})`
  return ''
})

let searchTimer = null
const onSearchChange = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; updateUrlQuery(); loadTaskList() }, 300) }
const onFilterChange = () => { page.value = 1; updateUrlQuery(); loadTaskList() }
const onPageSizeChange = () => { page.value = 1; loadTaskList() }

const updateUrlQuery = () => {
  const q = {}
  if (searchKey.value) q.searchKey = searchKey.value
  if (stateFilter.value) q.state = stateFilter.value
  if (page.value > 1) q.page = page.value
  router.replace({ query: q })
}

const loadTaskList = async () => {
  loading.value = true
  try {
    const { data, meta } = await getTaskListApi({ page: page.value, pageSize: pageSize.value, searchKey: searchKey.value, state: stateFilter.value })
    taskList.value = data; total.value = meta.total
  } finally { loading.value = false }
}

const onSelectionChange = (rows) => { selectedRows.value = rows }

const batchOp = async () => {
  if (batchBtnText.value.includes('提交')) {
    openBatchDeliver()
  } else if (batchBtnText.value.includes('验收')) {
    for (const row of selectedRows.value) { await reviewTaskApi(row.id, { pass: true, score: 100, comment: '批量验收通过', rejectReason: '' }) }
    ElMessage.success(`批量验收 ${selectedRows.value.length} 条`)
    loadTaskList()
  }
}

// Form operations (abbreviated - same core logic as before)
const resetCreateForm = () => { createFormRef.value?.resetFields(); Object.assign(createForm, { taskName: '', annotateType: '', sampleCount: null, unitPrice: null, deadline: '', qaStandard: '' }); dataPackage.value = null; packageFileList.value = [] }
const openCreate = () => { createVisible.value = true }

const handlePackageChange = (file) => {
  const r = new FileReader(); r.onload = (e) => { dataPackage.value = { fileName: file.name, data: e.target.result.split(',')[1] } }; r.readAsDataURL(file.raw); packageFileList.value = [file]
}
const handlePackageRemove = () => { dataPackage.value = null; packageFileList.value = [] }

const submitCreate = async () => {
  try { await createFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    const payload = { ...createForm }
    if (dataPackage.value) payload.dataPackage = dataPackage.value
    await createTaskApi(payload)
    ElMessage.success('任务已创建')
    createVisible.value = false; page.value = 1; loadTaskList()
  } finally { actionLoading.value = false }
}

const openEdit = (row) => { Object.assign(editForm, { id: row.id, taskName: row.taskName, annotateType: row.annotateType, sampleCount: row.sampleCount, unitPrice: row.unitPrice, deadline: row.deadline, qaStandard: row.qaStandard?.replace(/<[^>]*>/g, '') || '' }); editVisible.value = true }

const submitEdit = async () => {
  try { await editFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try { await updateTaskApi(editForm.id, editForm); ElMessage.success('已更新'); editVisible.value = false; loadTaskList() } finally { actionLoading.value = false }
}

const handleDelete = async (row) => {
  try { await ElMessageBox.confirm(`删除「${row.taskName}」？`, '删除任务', { type: 'warning' }) } catch { return }
  actionLoading.value = true
  try { await deleteTaskApi(row.id); ElMessage.success('已删除'); loadTaskList() } finally { actionLoading.value = false }
}

const openDispatch = async (row) => { currentTask.value = row; dispatchForm.supplierId = null; dispatchForm.immediateStart = false; try { const { data } = await getSupplierListApi(); supplierList.value = data } catch {}; dispatchVisible.value = true }
const submitDispatch = async () => {
  try { await dispatchFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try { await dispatchTaskApi(currentTask.value.id, dispatchForm); ElMessage.success('已派发'); dispatchVisible.value = false; loadTaskList() } finally { actionLoading.value = false }
}

const acceptTask = async (row) => { acceptingId.value = row.id; try { await acceptTaskApi(row.id); ElMessage.success('已接单，进入标注作业'); loadTaskList() } finally { acceptingId.value = null } }
const completeWork = async (row) => { await completeWorkApi(row.id); ElMessage.success('作业完成，可提交质检'); loadTaskList() }

const openDeliver = async (row) => {
  currentTask.value = row; currentTaskItems.value = []
  try { const { data } = await getTaskDetailApi(row.id); currentTaskItems.value = data.items || [] } catch {}
  deliverModalVisible.value = true
}

// 批量提交：每个任务独立选择数据包文件
const allBatchFilesReady = computed(() =>
  selectedRows.value.length > 0 && selectedRows.value.every(r => !!batchFiles[r.id])
)
const resetBatchDeliver = () => {
  for (const k of Object.keys(batchFiles)) delete batchFiles[k]
  for (const k of Object.keys(batchFileList)) delete batchFileList[k]
  batchDesc.value = ''
}
const openBatchDeliver = () => { resetBatchDeliver(); batchDeliverVisible.value = true }
const onBatchFileChange = (row, file) => { batchFiles[row.id] = file.raw || file; batchFileList[row.id] = [file] }
const onBatchFileRemove = (row) => { delete batchFiles[row.id]; delete batchFileList[row.id] }
const confirmBatchSubmit = async () => {
  if (!allBatchFilesReady.value) { ElMessage.warning('请为每个任务选择数据包文件'); return }
  actionLoading.value = true
  try {
    for (const row of selectedRows.value) {
      const file = batchFiles[row.id]
      const b64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(file) })
      await submitTaskApi(row.id, { fileName: file.name, fileSize: file.size, fileData: b64, submitDesc: batchDesc.value })
    }
    ElMessage.success(`批量提交 ${selectedRows.value.length} 条完成`)
    batchDeliverVisible.value = false
    loadTaskList()
  } catch { ElMessage.error('批量提交失败') } finally { actionLoading.value = false }
}

const openReview = (row) => {
  currentTask.value = row; reviewForm.pass = true; reviewForm.score = null; reviewForm.comment = ''; reviewForm.rejectReason = ''
  reviewVisible.value = true
}

const submitReview = async () => {
  try { await reviewFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try { await reviewTaskApi(currentTask.value.id, reviewForm); ElMessage.success(reviewForm.pass ? '验收通过' : '已驳回'); reviewVisible.value = false; loadTaskList() } finally { actionLoading.value = false }
}

onMounted(() => {
  const q = route.query
  if (q.searchKey) searchKey.value = q.searchKey
  if (q.state) stateFilter.value = q.state
  if (q.page) page.value = Number(q.page)
  loadTaskList()
})
</script>

<style scoped>
.filter-card { margin-bottom: 16px; }
.table-header { display: flex; justify-content: space-between; align-items: center; }
.pagination-wrap { margin-top: 16px; display: flex; align-items: center; }
.batch-deliver-list { max-height: 320px; overflow-y: auto; border: 1px solid #ebeef5; border-radius: 4px; padding: 8px 12px; }
.batch-deliver-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
.batch-deliver-item:last-child { border-bottom: none; }
.batch-deliver-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.batch-deliver-info .task-name { font-size: 13px; color: #303133; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch-upload { width: 200px; }
.batch-file-name { font-size: 12px; color: #67c23a; margin-top: 4px; word-break: break-all; }
.batch-file-name.empty { color: #909399; }
</style>
