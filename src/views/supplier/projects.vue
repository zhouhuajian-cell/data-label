<template>
  <div class="pm-page">
    <!-- 顶部统计 -->
    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <div class="pm-body">
      <!-- 左侧：项目列表 -->
      <div class="proj-list-panel">
        <div class="list-toolbar">
          <el-input v-model="searchKey" placeholder="搜索项目名称" clearable :prefix-icon="Search" />
        </div>
        <div class="list-filter">
          <el-radio-group v-model="statusFilter" size="small">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="active">进行中</el-radio-button>
            <el-radio-button value="completed">已完成</el-radio-button>
            <el-radio-button value="paused">已暂停</el-radio-button>
          </el-radio-group>
        </div>

        <div class="proj-cards" v-loading="loading">
          <el-empty v-if="!filteredProjects.length" description="暂无项目" :image-size="60" />
          <div v-for="proj in filteredProjects" :key="proj.id" class="proj-card"
            :class="{ active: selectedId === proj.id, overdue: projectOverdueCount(proj.id) > 0 }"
            @click="selectProject(proj)">
            <div class="pc-head">
              <span class="pc-name" :title="proj.name">{{ proj.name }}</span>
              <el-tag :type="statusTag(proj.status)" size="small">{{ statusMap[proj.status] }}</el-tag>
            </div>
            <div class="pc-client">{{ proj.annotateType }}</div>
            <div class="pc-progress">
              <el-progress :percentage="projectProgress(proj.id)" :stroke-width="8"
                :color="progressColor(projectProgress(proj.id))" />
              <span class="pc-progress-text">{{ projectAcceptedCount[proj.id] || 0 }}/{{ projectTaskCount[proj.id] || 0 }} 已验收</span>
            </div>
            <div class="pc-footer">
              <span class="pc-tasks"><el-icon><List /></el-icon>{{ projectTaskCount[proj.id] || 0 }} 任务</span>
              <el-tag v-if="projectOverdueCount(proj.id)" type="danger" size="small" effect="dark">
                <el-icon><Warning /></el-icon> {{ projectOverdueCount(proj.id) }} 逾期
              </el-tag>
              <el-tag v-else-if="projectActiveCount(proj.id)" type="primary" size="small" effect="plain">
                {{ projectActiveCount(proj.id) }} 进行中
              </el-tag>
            </div>
          </div>
        </div>

        <div class="list-footer">
          <template v-if="isAdminLike">
            <el-button :icon="Upload" @click="openImport" style="flex:1">批量导入</el-button>
            <el-button type="primary" :icon="Plus" @click="wizardRef?.open()" style="flex:1">新建项目</el-button>
          </template>
          <el-button v-else style="flex:1" disabled>供应商只读视图</el-button>
        </div>
      </div>

      <!-- 右侧：项目工作区 -->
      <div class="proj-detail-panel" v-loading="detailLoading">
        <template v-if="selectedProject">
          <!-- 项目头部 -->
          <el-card class="proj-header" shadow="hover">
            <div class="ph-main">
              <div class="ph-title-row">
                <span class="ph-name">{{ selectedProject.name }}</span>
                <el-tag :type="statusTag(selectedProject.status)">{{ statusMap[selectedProject.status] }}</el-tag>
              </div>
              <el-descriptions :column="3" class="ph-desc" size="small">
                <el-descriptions-item label="标注类型">{{ selectedProject.annotateType }}</el-descriptions-item>
                <el-descriptions-item label="样本量">{{ selectedProject.sampleCount?.toLocaleString() || 0 }}</el-descriptions-item>
                <el-descriptions-item label="截止">{{ selectedProject.deadline }}</el-descriptions-item>
                <el-descriptions-item v-if="selectedProject.template" label="项目模板">{{ selectedProject.template }}</el-descriptions-item>
                <el-descriptions-item v-if="selectedProject.uploadPath" label="数据上传路径">{{ selectedProject.uploadPath }}</el-descriptions-item>
              </el-descriptions>
              <div v-if="selectedProject.description" class="ph-desc-text">{{ selectedProject.description }}</div>
            </div>
            <div class="ph-actions" v-if="isAdminLike">
              <el-button size="small" :icon="Edit" @click="taskDialogsRef?.openEditProject(selectedProject)">编辑</el-button>
              <el-select :model-value="selectedProject.status" size="small" style="width:104px" @change="(v) => handleStatusChange(selectedProject, v)">
                <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
              <el-button size="small" type="danger" plain :icon="Delete" @click="deleteProject(selectedProject)">删除</el-button>
              <el-button v-if="selectedProject.status === 'active'" size="small" type="success" :icon="Finished" @click="onArchiveProject">结项归档</el-button>
              <el-button size="small" :icon="Promotion" @click="onPushFeishu">推送飞书</el-button>
            </div>
          </el-card>

          <!-- 任务管理 -->
          <el-card class="task-panel" shadow="never">
            <div class="tp-toolbar">
              <div class="tp-title">任务明细</div>
              <div class="tp-actions">
                <template v-if="isAdminLike">
                  <el-button v-if="selectedTasks.length" size="small" type="warning" plain :icon="Promotion" @click="taskDialogsRef?.openBatchDispatch(selectedTasks)">
                    批量派发 ({{ selectedTasks.length }})
                  </el-button>
                  <el-button size="small" :icon="Upload" @click="importTasksRef?.open(selectedProject)">导入任务</el-button>
                  <el-button size="small" type="primary" plain :icon="Plus" @click="taskDialogsRef?.openAddTask(selectedProject)">添加任务</el-button>
                </template>
                <el-button v-if="!isAdminLike" size="small" type="success" :icon="Upload" @click="openDeliverForSelected">提交交付</el-button>
                <el-button v-if="!isAdminLike && selectedTasks.some(t => t.state === 'ACCEPTED')" size="small" type="warning" :icon="Promotion" @click="goSettlement">结算</el-button>
              </div>
            </div>

            <!-- 状态 chips（可点击过滤） -->
            <div class="state-chips">
              <span class="chip" :class="{ active: stateFilter === '' }" @click="stateFilter = ''">
                全部 <b>{{ detailTasks.length }}</b>
              </span>
              <span v-for="chip in stateChips" :key="chip.value" class="chip"
                :class="['chip-' + chip.type, { active: stateFilter === chip.value }]"
                @click="stateFilter = stateFilter === chip.value ? '' : chip.value">
                {{ chip.label }} <b>{{ chip.count }}</b>
              </span>
            </div>

            <el-table :data="filteredDetailTasks" border size="small" row-key="id"
              :row-class-name="taskRowClass"
              @selection-change="onSelectionChange"
              @expand-change="handleExpand">
              <el-table-column type="selection" width="40" :selectable="row => isAdminLike ? ['UNASSIGNED','REJECTED'].includes(row.state) : ['VENDOR_QA','REJECTED','CLIENT_QA','ACCEPTED'].includes(row.state)" />
              <el-table-column type="expand">
                <template #default="scope">
                  <TaskItemsTable
                    :items="taskItems[scope.row.id] || []"
                    :loading="itemsLoading[scope.row.id]"
                    :task-row="scope.row"
                    @update-status="updateItemStatus"
                    @save-fail-reason="saveFailReason"
                    @delete-item="deleteItem"
                    @batch-update="batchUpdateItems"
                    @import-items="(r) => importItemsRef?.open(r)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="任务名称" prop="taskName" min-width="150" show-overflow-tooltip>
                <template #default="scope">
                  <span class="task-name-cell">
                    <el-icon v-if="isOverdue(scope.row)" color="#f56c6c" :title="'已逾期'"><Warning /></el-icon>
                    {{ scope.row.taskName }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="类型" prop="annotateType" width="105" />
              <el-table-column label="样本量" prop="sampleCount" width="72" />
              <el-table-column label="单价" width="66"><template #default="s">¥{{ s.row.unitPrice }}</template></el-table-column>
              <el-table-column label="供应商" prop="supplierName" width="96">
                <template #default="scope">{{ scope.row.supplierName || '-' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="88">
                <template #default="scope">
                  <el-tag :type="getStateType(scope.row.state)" size="small">{{ getStateText(scope.row.state) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="截止" prop="deadline" width="130">
                <template #default="scope">
                  <span :style="{ color: isOverdue(scope.row) ? '#f56c6c' : 'inherit' }">{{ scope.row.deadline }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="280" fixed="right">
                <template #default="scope">
                  <el-button text size="small" type="primary" @click="$router.push('/task/detail/' + scope.row.id)">详情</el-button>
                  <el-button v-if="isAdminLike" text size="small" type="primary" @click="openUploadPackage(scope.row)">导入数据包</el-button>
                  <el-button v-if="!isAdminLike && scope.row.dataPackage" text size="small" type="primary" @click="downloadTaskPackage(scope.row)">下载数据包</el-button>
                  <el-button v-if="isAdminLike && ['UNASSIGNED','REJECTED'].includes(scope.row.state)" text size="small" type="primary" @click="dispatchSingle(scope.row)">派发</el-button>
                  <el-button v-if="isAdminLike && scope.row.state === 'CLIENT_QA'" text size="small" type="success" @click="taskDialogsRef?.reviewSingle(scope.row)">验收</el-button>
                  <el-button v-if="['CLIENT_QA','ACCEPTED'].includes(scope.row.state)" text size="small" type="primary" @click="downloadSubmission(scope.row)">下载成果</el-button>
                  <el-button v-if="['ACCEPTED','ARCHIVED'].includes(scope.row.state)" text size="small" type="warning" @click="$router.push('/finance/bill')">结算</el-button>
                  <el-button v-if="!isAdminLike && ['VENDOR_QA','REJECTED'].includes(scope.row.state)" text size="small" type="success" @click="$router.push('/task/detail/' + scope.row.id)">提交</el-button>
                  <el-dropdown v-if="isAdminLike" trigger="click" @command="(cmd) => handleTaskCommand(cmd, scope.row)">
                    <el-button text size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="workbench" v-if="scope.row.annotateType === '2D拉框' && ['ANNOTATING','VENDOR_QA','CLIENT_QA'].includes(scope.row.state)">进入工作台</el-dropdown-item>
                        <el-dropdown-item command="edit" v-if="scope.row.state === 'UNASSIGNED'">编辑任务</el-dropdown-item>
                        <el-dropdown-item command="dispatch" v-if="['UNASSIGNED','REJECTED'].includes(scope.row.state)">派发任务</el-dropdown-item>
                        <el-dropdown-item command="delete" v-if="scope.row.state === 'UNASSIGNED'" divided>删除任务</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
              <template #empty>
                <span style="color:#c0c4cc">暂无任务</span>
              </template>
            </el-table>
          </el-card>
        </template>
        <el-empty v-else description="请选择左侧项目查看详情" :image-size="120" style="margin-top:120px" />
      </div>
    </div>







    <!-- 数据包上传 -->
    <input ref="pkgInputRef" type="file" accept=".zip,.tar,.gz,.7z" style="display:none" @change="onPkgInputChange" />

    <!-- 导入明细 -->

    <!-- 新建项目向导 -->
    <CreateProjectWizard ref="wizardRef" @created="loadProjects" />

    <!-- 导入任务 / 导入明细 -->
    <ImportTasksDialog ref="importTasksRef" @imported="loadProjectTasks(selectedId)" />
    <ImportItemsDialog ref="importItemsRef" @imported="reloadItems" />

    <!-- 编辑项目 / 添加编辑任务 / 派发 / 验收 -->
    <TaskDialogs ref="taskDialogsRef" :supplier-list="supplierList"
      @project-saved="loadProjects" @task-saved="loadProjectTasks(selectedId)"
      @dispatched="clearSelectionAndRefresh" @reviewed="loadProjectTasks(selectedId)" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Search, Plus, Upload, Edit, Delete, ArrowDown, List, Warning, Promotion, Connection, Finished } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { getProjectsApi, updateProjectStatusApi, updateProjectApi, deleteProjectApi, importProjectsApi, archiveProjectApi } from '@/api/projects'
import { getSupplierListApi, deleteTaskApi, getTaskListApi, getTaskDetailApi } from '@/api/tasks'
import { getTaskItemsApi, updateTaskItemApi, deleteTaskItemApi, batchUpdateTaskItemsApi, uploadTaskPackageApi } from '@/api/items'
import { pushProjectSummaryApi } from '@/api/feishu'
import { useDownload } from '@/composables/useDownload'
import { getTaskStateText as getStateText, getTaskStateType as getStateType, REJECT_ERROR_TYPES, ITEM_STATUS_MAP } from '@/utils/constants'
import CreateProjectWizard from './components/CreateProjectWizard.vue'
import ImportTasksDialog from './components/ImportTasksDialog.vue'
import ImportItemsDialog from './components/ImportItemsDialog.vue'
import TaskDialogs from './components/TaskDialogs.vue'
import TaskItemsTable from './components/TaskItemsTable.vue'

const router = useRouter()
const userStore = useUserStore()
const { downloadFile } = useDownload()
const wizardRef = ref(null)
const importTasksRef = ref(null)
const importItemsRef = ref(null)
const taskDialogsRef = ref(null)

// 派发完成后：清空勾选并刷新
const clearSelectionAndRefresh = () => {
  selectedTasks.value = []
  loadProjectTasks(selectedId.value)
}

// 导入明细成功后刷新指定任务的明细
const reloadItems = () => {
  const id = selectedId.value
  if (!id) return
  taskItems[id] = null
  loadItems({ id })
}
const isAdminLike = computed(() => [1, 7].includes(userStore.userInfo.roleType))
const loading = ref(false)
const detailLoading = ref(false)
const actionLoading = ref(false)
const projectList = ref([])
const selectedId = ref(null)
const projectTasks = reactive({})
const projectTaskCount = reactive({})
const projectAcceptedCount = reactive({})
const projectActiveCountMap = reactive({})
const projectOverdueCountMap = reactive({})
const taskItems = reactive({})
const itemsLoading = reactive({})

const supplierList = ref([])
const selectedTasks = ref([])
const expandedTaskId = ref(null)
const dialogTaskOptions = ref([])

const searchKey = ref('')
const statusFilter = ref('')
const stateFilter = ref('')


const statusOptions = [
  { label: '进行中', value: 'active' }, { label: '已完成', value: 'completed' },
  { label: '已暂停', value: 'paused' }, { label: '已归档', value: 'archived' }
]
const statusMap = { active: '进行中', completed: '已完成', paused: '已暂停', archived: '已归档' }
const statusTag = (s) => ({ active: '', completed: 'success', paused: 'warning', archived: 'info' }[s] || '')
const progressColor = (p) => (p >= 80 ? '#67c23a' : p >= 40 ? '#e6a23c' : '#409eff')

// 统计卡片
const statCards = computed(() => {
  const active = projectList.value.filter(p => p.status === 'active').length
  const completed = projectList.value.filter(p => p.status === 'completed').length
  const totalSamples = projectList.value.reduce((a, p) => a + (p.sampleCount || 0), 0)
  return [
    { key: 'projects', val: projectList.value.length, label: '项目总数', color: '#409eff' },
    { key: 'active', val: active, label: '进行中', color: '#67c23a' },
    { key: 'completed', val: completed, label: '已完成', color: '#909399' },
    { key: 'samples', val: totalSamples.toLocaleString(), label: '样本总量', color: '#e6a23c' }
  ]
})

const filteredProjects = computed(() => {
  let list = projectList.value
  if (statusFilter.value) list = list.filter(p => p.status === statusFilter.value)
  if (searchKey.value.trim()) {
    const k = searchKey.value.trim().toLowerCase()
    list = list.filter(p => p.name.toLowerCase().includes(k))
  }
  return list
})

const selectedProject = computed(() => projectList.value.find(p => p.id === selectedId.value))
const detailTasks = computed(() => projectTasks[selectedId.value] || [])

const filteredDetailTasks = computed(() => {
  if (!stateFilter.value) return detailTasks.value
  return detailTasks.value.filter(t => t.state === stateFilter.value)
})

// 任务状态 chips
const stateChips = computed(() => {
  const map = {}
  detailTasks.value.forEach(t => { map[t.state] = (map[t.state] || 0) + 1 })
  const order = [
    { value: 'UNASSIGNED', label: '待指派', type: 'warning' },
    { value: 'ANNOTATING', label: '标注中', type: 'primary' },
    { value: 'VENDOR_QA', label: '供应商质检', type: 'warning' },
    { value: 'CLIENT_QA', label: '甲方质检', type: 'primary' },
    { value: 'ACCEPTED', label: '已验收', type: 'success' },
    { value: 'REJECTED', label: '驳回', type: 'danger' }
  ]
  return order.filter(o => map[o.value]).map(o => ({ ...o, count: map[o.value] }))
})

const projectProgress = (projectId) => {
  const total = projectTaskCount[projectId] || 0
  return total ? Math.round((projectAcceptedCount[projectId] || 0) / total * 100) : 0
}
const projectOverdueCount = (projectId) => projectOverdueCountMap[projectId] || 0
const projectActiveCount = (projectId) => projectActiveCountMap[projectId] || 0

const isOverdue = (task) => {
  if (!task.deadline || ['ACCEPTED', 'ARCHIVED'].includes(task.state)) return false
  return new Date(task.deadline.replace(/-/g, '/')).getTime() < Date.now()
}

const taskRowClass = ({ row }) => (isOverdue(row) ? 'row-overdue' : '')

function selectProject(proj) {
  selectedId.value = proj.id
  stateFilter.value = ''
  selectedTasks.value = []
  loadProjectTasks(proj.id)
}




// ===== 数据包上传/下载 =====
const pkgInputRef = ref(null)
const pkgUploadingTask = ref(null)
function openUploadPackage(row) {
  pkgUploadingTask.value = row
  pkgInputRef.value?.click()
}
async function onPkgInputChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !pkgUploadingTask.value) return
  actionLoading.value = true
  try {
    const b64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(file) })
    const json = await uploadTaskPackageApi(pkgUploadingTask.value.id, { fileName: file.name, fileData: b64 })
    ElMessage.success('数据包已上传')
    loadProjectTasks(selectedId.value)
  } catch { ElMessage.error('上传失败') }
  finally { actionLoading.value = false }
}
async function downloadTaskPackage(row) {
  if (!row.dataPackage?.storedName) { ElMessage.warning('该任务暂无数据包'); return }
  try {
    await downloadFile('/files/download/' + row.dataPackage.storedName, row.dataPackage.fileName || 'data.zip')
  } catch { ElMessage.error('下载失败') }
}

const deleteTask = async (row) => {
  try { await ElMessageBox.confirm(`确认删除「${row.taskName}」？`, '删除', { type: 'warning' }) } catch { return }
  await deleteTaskApi(row.id)
  ElMessage.success('已删除')
  loadProjectTasks(selectedId.value)
}

const handleTaskCommand = (cmd, row) => {
  if (cmd === 'edit') taskDialogsRef.value?.editTask(row)
  else if (cmd === 'dispatch') taskDialogsRef.value?.dispatchSingle(row)
  else if (cmd === 'delete') deleteTask(row)
  else if (cmd === 'workbench') router.push('/workbench/' + row.id)
}

const onSelectionChange = (rows) => { selectedTasks.value = rows }
const openDeliverForSelected = () => {
  const t = selectedTasks.value[0]
  if (!t) { ElMessage.warning('请先勾选一个任务'); return }
  if (!['VENDOR_QA', 'REJECTED'].includes(t.state)) { ElMessage.warning('当前任务状态不可提交交付'); return }
  router.push('/task/detail/' + t.id)
}
const goSettlement = () => {
  router.push('/finance/bill')
}


const handleStatusChange = async (proj, val) => {
  try { await ElMessageBox.confirm(`确认将项目状态变更为「${statusMap[val]}」？`, '状态变更', { type: 'warning' }) } catch { return }
  await updateProjectStatusApi(proj.id, { status: val })
  proj.status = val
  ElMessage.success('状态已更新')
}

const onArchiveProject = async () => {
  const proj = selectedProject.value
  if (!proj) return
  try {
    await ElMessageBox.confirm(
      `结项「${proj.name}」后，所有已验收数据将归档生成 Dataset 版本快照，项目状态变为已归档。`,
      '项目结项归档', { confirmButtonText: '确认结项', type: 'success' }
    )
  } catch { return }
  try {
    const { data, message } = await archiveProjectApi(proj.id)
    if (data) {
      ElMessage.success(`项目已结项归档，生成 Dataset：${data.archivedDataset.name}（${data.archivedDataset.itemCount} 条数据）`)
      loadProjects()
    } else ElMessage.error(message)
  } catch { ElMessage.error('结项失败') }
}

async function onPushFeishu() {
  const proj = selectedProject.value
  if (!proj) return
  try {
    const { data } = await pushProjectSummaryApi(proj.id)
    if (data?.sent) {
      ElMessage.success(`已推送项目摘要到飞书（${data.results?.length || 0} 个群）`)
    } else {
      ElMessage.warning(data?.reason || data?.results?.[0]?.resp || '推送失败，请先配置飞书 Webhook')
    }
  } catch { ElMessage.error('推送失败') }
}

async function downloadSubmission(row) {
  try {
    // 获取任务详情取提交版本
    const { data } = await getTaskDetailApi(row.id)
    const versions = data?.versions || []
    const latest = versions[versions.length - 1]
    if (!latest || !latest.storedName) { ElMessage.warning('该任务尚未提交成果文件'); return }
    // 触发下载
    await downloadFile('/submissions/' + latest.id + '/download', latest.fileName || 'submission_' + latest.id)
  } catch { ElMessage.error('下载失败') }
}

async function handleExpand(row) {
  expandedTaskId.value = row?.id || null
  if (row) loadItems(row)
}

const deleteProject = async (proj) => {
  const taskCount = projectTaskCount[proj.id] || 0
  try {
    await ElMessageBox.confirm(
      `删除项目「${proj.name}」将同时删除其下 ${taskCount} 个任务及相关明细、日志数据，且不可恢复！`,
      '删除项目（级联删除）',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'error', confirmButtonClass: 'el-button--danger' }
    )
  } catch { return }
  try {
    const { data } = await deleteProjectApi(proj.id)
    ElMessage.success(`项目已删除，同时删除 ${data?.deletedTasks ?? 0} 个任务`)
    if (selectedId.value === proj.id) selectedId.value = null
    loadProjects()
  } catch {}
}

// ===== 数据加载 =====
const loadProjects = async () => {
  loading.value = true
  try {
    const { data } = await getProjectsApi()
    projectList.value = data
    loadAllProjects()
    if (!selectedId.value && data.length) {
      selectedId.value = data[0].id
    }
  } finally { loading.value = false }
}

const loadAllProjects = () => { projectList.value.forEach(p => loadProjectTasks(p.id)) }

const loadProjectTasks = async (projectId) => {
  detailLoading.value = true
  try {
    const { data, meta } = await getTaskListApi({ projectId, pageSize: 200 })
    projectTasks[projectId] = data
    projectTaskCount[projectId] = meta.total
    projectAcceptedCount[projectId] = data.filter(t => t.state === 'ACCEPTED').length
    projectActiveCountMap[projectId] = data.filter(t => ['ANNOTATING', 'VENDOR_QA', 'CLIENT_QA'].includes(t.state)).length
    projectOverdueCountMap[projectId] = data.filter(t => isOverdue(t)).length
  } catch {
    projectTasks[projectId] = []; projectTaskCount[projectId] = 0; projectAcceptedCount[projectId] = 0
    projectActiveCountMap[projectId] = 0; projectOverdueCountMap[projectId] = 0
  } finally { detailLoading.value = false }
}



// ===== 明细 =====
const loadItems = async (taskRow) => {
  const taskId = taskRow && taskRow.id
  if (!taskId) return
  if (taskItems[taskId]) return
  itemsLoading[taskId] = true
  try { const { data } = await getTaskItemsApi(taskId); taskItems[taskId] = data }
  catch { taskItems[taskId] = [] }
  finally { itemsLoading[taskId] = false }
}
const updateItemStatus = async (taskId, item, newStatus) => {
  try { await updateTaskItemApi(taskId, item.id, { status: newStatus }); item.status = newStatus; ElMessage.success(`状态已更新为${ITEM_STATUS_MAP[newStatus]}`) } catch { ElMessage.error('更新失败') }
}
const saveFailReason = async (taskId, item) => {
  try { await updateTaskItemApi(taskId, item.id, { status: item.status, failReason: item.failReason }); ElMessage.success('备注已保存') } catch { ElMessage.error('保存失败') }
}
const batchUpdateItems = async (taskRow) => {
  const items = taskItems[taskRow.id] || []
  if (!items.length) return ElMessage.warning('没有明细')
  try { await batchUpdateTaskItemsApi(taskRow.id, { itemIds: items.map(i => i.id), status: 'annotated' }); items.forEach(i => { i.status = 'annotated'; i.failReason = '' }); ElMessage.success('全部标为已标注') } catch { ElMessage.error('操作失败') }
}

const deleteItem = async (taskId, item) => {
  try { await deleteTaskItemApi(taskId, item.id); const idx = taskItems[taskId]?.indexOf(item); if (idx >= 0) taskItems[taskId].splice(idx, 1); ElMessage.success('明细已删除') } catch { ElMessage.error('删除失败') }
}

// 批量导入项目
const openImport = () => {
  ElMessageBox.prompt('批量导入项目（每行一个）：\n项目名称,标注类型,样本数量,截止时间', '导入项目', {
    confirmButtonText: '导入', inputType: 'textarea',
    inputPlaceholder: '示例项目,3D点云标注,50000,2026-09-30\n示例项目2,2D拉框,30000,2026-10-15'
  }).then(async ({ value }) => {
    const rows = value.trim().split('\n').filter(l => l.trim()).map(line => {
      const p = line.split(',').map(s => s.trim())
      return { name: p[0] || '-', annotateType: p[1] || '2D拉框', sampleCount: Number(p[2]) || 0, deadline: p[3] || '-', description: p[4] || '' }
    })
    if (!rows.length) return
    actionLoading.value = true
    try { const { data } = await importProjectsApi(rows); ElMessage.success(`导入 ${data.imported} 个项目`); loadProjects() } finally { actionLoading.value = false }
  }).catch(() => {})
}

onMounted(() => { loadProjects(); window.addEventListener('focus', loadProjects); window.addEventListener('visibilitychange', () => { if (!document.hidden) loadProjects() }) })
</script>

<style scoped>
.pm-page { display: flex; flex-direction: column; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.stat-card { text-align: center; }
.stat-num { font-size: 28px; font-weight: bold; }
.stat-label { color: #909399; margin-top: 6px; font-size: 13px; }

.pm-body { display: grid; grid-template-columns: 320px 1fr; gap: 12px; min-height: 0; }

/* 左侧项目列表 */
.proj-list-panel { display: flex; flex-direction: column; background: #fff; border-radius: 8px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.list-toolbar { margin-bottom: 10px; }
.list-filter { margin-bottom: 12px; }
.list-filter :deep(.el-radio-group) { width: 100%; display: flex; }
.list-filter :deep(.el-radio-button) { flex: 1; }
.list-filter :deep(.el-radio-button__inner) { width: 100%; padding: 6px 4px; font-size: 12px; }
.proj-cards { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; min-height: 200px; max-height: calc(100vh - 320px); }
.proj-card { border: 1px solid #ebeef5; border-radius: 8px; padding: 12px; cursor: pointer; transition: all 0.2s; }
.proj-card:hover { border-color: #c6e2ff; box-shadow: 0 2px 8px rgba(64,158,255,0.12); }
.proj-card.active { border-color: #409eff; background: #ecf5ff; }
.proj-card.overdue { border-left: 3px solid #f56c6c; }
.pc-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
.pc-name { font-weight: 600; font-size: 14px; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-client { font-size: 12px; color: #909399; margin-bottom: 8px; }
.pc-progress { display: flex; align-items: center; gap: 8px; }
.pc-progress :deep(.el-progress) { flex: 1; }
.pc-progress-text { font-size: 11px; color: #909399; white-space: nowrap; }
.pc-footer { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.pc-tasks { display: flex; align-items: center; gap: 3px; font-size: 12px; color: #909399; margin-right: auto; }
.list-footer { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #ebeef5; }

/* 右侧工作区 */
.proj-detail-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.proj-header { display: flex; }
.proj-header :deep(.el-card__body) { display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 16px; }
.ph-main { flex: 1; min-width: 0; }
.ph-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ph-name { font-size: 18px; font-weight: 700; color: #303133; }
.ph-desc { margin-bottom: 4px; }
.ph-desc-text { font-size: 13px; color: #909399; margin-top: 8px; line-height: 1.6; }
.ph-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.task-panel :deep(.el-card__body) { padding: 12px 16px; }
.tp-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.tp-title { font-size: 15px; font-weight: 600; border-left: 3px solid #409eff; padding-left: 8px; }
.tp-actions { display: flex; gap: 8px; }

.state-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip { padding: 4px 12px; border-radius: 16px; background: #f5f7fa; color: #606266; font-size: 13px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; user-select: none; }
.chip b { margin-left: 2px; }
.chip:hover { background: #ecf5ff; }
.chip.active { background: #409eff; color: #fff; }
.chip-warning.active { background: #e6a23c; }
.chip-primary.active { background: #409eff; }
.chip-success.active { background: #67c23a; }
.chip-danger.active { background: #f56c6c; }

.task-name-cell { display: flex; align-items: center; gap: 4px; }
:deep(.row-overdue) { background: #fef0f0; }

.create-steps { margin-bottom: 4px; }
.step2-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.step2-tip { font-size: 13px; color: #909399; }
.create-total { text-align: right; color: #e6a23c; font-weight: bold; margin-top: 8px; font-size: 13px; }
.supplier-info { background: #f5f7fa; border-radius: 6px; padding: 12px; margin: 8px 0; }
.si-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; color: #606266; }
.si-row span { color: #909399; }
.import-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.import-preview { margin-top: 16px; padding-top: 12px; border-top: 1px solid #ebeef5; }
.import-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
</style>
