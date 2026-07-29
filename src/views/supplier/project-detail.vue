<template>
  <div class="project-detail" v-loading="loading">
    <el-page-header @back="$router.push('/supplier/projects')" content="项目详情" class="page-head" />

    <el-card class="info-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>基本信息</span>
          <el-tag :type="statusTagType(project.status)">{{ statusLabelMap[project.status] }}</el-tag>
        </div>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="项目名称">{{ project.name }}</el-descriptions-item>
        <el-descriptions-item label="标注类型">{{ project.annotateType }}</el-descriptions-item>
        <el-descriptions-item label="样本数量">{{ project.sampleCount?.toLocaleString() || 0 }}</el-descriptions-item>
        <el-descriptions-item label="截止时间">{{ project.deadline }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ project.createdAt }}</el-descriptions-item>
        <el-descriptions-item label="项目描述" :span="3">{{ project.description || '-' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>任务明细（{{ total }} 条）</span>
          <div class="header-actions">
            <el-button type="primary" @click="openImport">一键导入明细</el-button>
            <el-button @click="openCreateTask">新建任务</el-button>
          </div>
        </div>
      </template>

      <el-table :data="taskList" border>
        <el-table-column label="ID" prop="id" width="60" />
        <el-table-column label="Nano ID" prop="nanoId" width="90" />
        <el-table-column label="任务名称" prop="taskName" min-width="180" show-overflow-tooltip />
        <el-table-column label="标注类型" prop="annotateType" width="120" />
        <el-table-column label="样本量" prop="sampleCount" width="100" />
        <el-table-column label="单价" width="80">
          <template #default="scope">￥{{ scope.row.unitPrice }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="getStateType(scope.row.state)" size="small">{{ getStateText(scope.row.state) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="截止时间" prop="deadline" width="160" />
        <el-table-column label="操作" width="200">
          <template #default="scope">
            <el-button text type="primary" @click="$router.push('/task/detail/' + scope.row.id)">详情</el-button>
            <el-button v-if="scope.row.state === 'DRAFT'" text type="danger" @click="handleTaskDelete(scope.row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="该项目下暂无任务，点击上方「一键导入明细」或「新建任务」添加" :image-size="80" />
        </template>
      </el-table>
      <div v-if="total > 10" class="pagination-wrap">
        <el-pagination v-model:current-page="page" :page-size="10" layout="total, prev, pager, next" :total="total" @current-change="loadTasks" />
      </div>
    </el-card>

    <!-- 一键导入明细 -->
    <el-dialog v-model="importVisible" title="一键导入项目明细" width="750px" @closed="resetImport">
      <el-tabs v-model="importTab" @tab-change="resetImport">
        <el-tab-pane label="上传文件" name="file">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <span style="color:#909399;font-size:13px">支持 CSV/TXT 文件</span>
            <el-button size="small" text type="primary" @click="downloadTemplate">下载CSV模板</el-button>
          </div>
          <el-upload drag :limit="1" :auto-upload="false" :on-change="handleFileParse" :file-list="importFileList" accept=".csv,.txt">
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽 CSV/TXT 文件到这里或<em>点击上传</em></div>
            <template #tip>
              <div class="el-upload__tip">格式：任务名称,标注类型,样本数量,单价,截止时间,标注规范</div>
            </template>
          </el-upload>
        </el-tab-pane>
        <el-tab-pane label="粘贴数据" name="text">
          <el-alert type="info" :closable="false" style="margin-bottom:16px">
            <template #title>每行一个任务，逗号分隔：任务名称,标注类型,样本数量,单价,截止时间,标注规范</template>
          </el-alert>
          <el-input v-model="importText" type="textarea" :rows="10" placeholder="A01-城市道路点云,3D点云标注,10000,0.15,2026-08-30,按规范标注&#10;A02-行人2D框标注,2D拉框,5000,0.08,2026-09-15," />
          <el-button style="margin-top:16px" type="primary" :disabled="!importText.trim()" @click="parseImportText">解析数据</el-button>
        </el-tab-pane>
      </el-tabs>

      <template v-if="importPreview.length">
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #ebeef5">
          <p style="margin-bottom:12px">共识别 <b>{{ importPreview.length }}</b> 条任务</p>
          <el-table :data="importPreview" border max-height="300" size="small">
            <el-table-column label="任务名称" prop="taskName" />
            <el-table-column label="Nano ID" prop="nanoId" width="100" />
            <el-table-column label="标注类型" prop="annotateType" />
            <el-table-column label="样本量" prop="sampleCount" width="80" />
            <el-table-column label="截止时间" prop="deadline" width="120" />
          </el-table>
          <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
            <el-button @click="resetImport">重新选择</el-button>
            <el-button type="primary" :loading="actionLoading" @click="submitImport">一键导入</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 新建任务 -->
    <el-dialog v-model="createVisible" title="新建任务" width="560px" @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="任务名称" prop="taskName">
          <el-input v-model="createForm.taskName" placeholder="请输入任务名称" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="标注类型" prop="annotateType">
          <el-select v-model="createForm.annotateType" placeholder="请选择" style="width:100%">
            <el-option label="2D拉框" value="2D拉框" />
            <el-option label="3D点云标注" value="3D点云标注" />
            <el-option label="语义分割" value="语义分割" />
            <el-option label="车道线标注" value="车道线标注" />
          </el-select>
        </el-form-item>
        <el-form-item label="样本数量" prop="sampleCount">
          <el-input-number v-model="createForm.sampleCount" :min="1" :max="100000" style="width:100%" />
        </el-form-item>
        <el-form-item label="单价" prop="unitPrice">
          <el-input-number v-model="createForm.unitPrice" :min="0.01" :max="100" :precision="2" style="width:100%" />
        </el-form-item>
        <el-form-item label="截止时间" prop="deadline">
          <el-date-picker v-model="createForm.deadline" type="datetime" placeholder="选择截止时间" style="width:100%" value-format="YYYY-MM-DD HH:mm" />
        </el-form-item>
        <el-form-item label="标注规范">
          <el-input v-model="createForm.qaStandard" type="textarea" :rows="3" placeholder="标注规范要求" maxlength="2000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitCreate">保存草稿</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { getProjectDetailApi, importProjectTasksApi } from '@/api/projects'
import { createTaskApi, deleteTaskApi, getTaskListApi } from '@/api/tasks'
import { getTaskStateText as getStateText, getTaskStateType as getStateType } from '@/utils/constants'

const route = useRoute()
const projectId = Number(route.params.id)

const loading = ref(false)
const actionLoading = ref(false)
const project = ref({})
const taskList = ref([])
const total = ref(0)
const page = ref(1)

const statusLabelMap = { active: '进行中', completed: '已完成', paused: '已暂停', archived: '已归档' }
const statusTagType = (s) => ({ active: '', completed: 'success', paused: 'warning', archived: 'info' }[s] || '')

const createVisible = ref(false)
const createFormRef = ref(null)
const createForm = reactive({ taskName: '', annotateType: '', sampleCount: null, unitPrice: null, deadline: '', qaStandard: '' })
const createRules = {
  taskName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }],
  sampleCount: [{ required: true, message: '请输入样本数量', trigger: 'blur' }],
  unitPrice: [{ required: true, message: '请输入单价', trigger: 'blur' }],
  deadline: [{ required: true, message: '请选择截止时间', trigger: 'change' }]
}

const importVisible = ref(false)
const importTab = ref('file')
const importText = ref('')
const importFileList = ref([])
const importPreview = ref([])

const resetImport = () => { importText.value = ''; importFileList.value = []; importPreview.value = [] }

const parseLines = (text) => text.trim().split('\n').filter(l => l.trim()).map(line => {
  const p = line.split(',').map(s => s.trim())
  return { taskName: p[0] || '-', nanoId: p[1] || '', annotateType: p[2] || '2D拉框', sampleCount: Number(p[3]) || 0, deadline: p[4] || '-', qaStandard: p[5] || '' }
})

const handleFileParse = (file) => {
  importFileList.value = [file]
  const reader = new FileReader()
  reader.onload = (e) => {
    let text = e.target.result
    if (text.includes('锟斤拷') || text.includes('\ufffd') || /[^\x00-\x7f\u4e00-\u9fff\uff00-\uffef，,、；;\.\d\s\n\r-]/.test(text.slice(0, 200))) {
      ElMessage.warning('文件编码可能不是UTF-8，尝试用GBK重新读取')
      const r2 = new FileReader()
      r2.onload = (ev) => { importPreview.value = parseLines(ev.target.result) }
      r2.readAsText(file.raw, 'GB2312')
      return
    }
    importPreview.value = parseLines(text)
  }
  reader.readAsText(file.raw)
}
const parseImportText = () => { importPreview.value = parseLines(importText.value) }

const openImport = () => { resetImport(); importTab.value = 'file'; importVisible.value = true }

const downloadTemplate = () => {
  const BOM = '\uFEFF'
  const header = '任务名称,Nano ID,标注类型,样本数量,截止时间,标注规范\n'
  const example = '示例-城市道路点云,ND001,3D点云标注,10000,2026-09-30,请按项目规范完成标注\n示例-行人2D框,ND002,2D拉框,5000,2026-10-15,漏标率不高于0.5%'
  const blob = new Blob([BOM + header + example], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = '项目任务导入模板.csv'; a.click()
  URL.revokeObjectURL(url)
}

const submitImport = async () => {
  if (!importPreview.value.length) return
  actionLoading.value = true
  try {
    const { data } = await importProjectTasksApi(projectId, importPreview.value)
    ElMessage.success(`成功导入 ${data.imported} 条任务`)
    importVisible.value = false
    loadTasks()
  } finally { actionLoading.value = false }
}

const loadDetail = async () => {
  loading.value = true
  try {
    const { data } = await getProjectDetailApi(projectId)
    project.value = data.project
    loadTasks()
  } finally { loading.value = false }
}

const loadTasks = async () => {
  try {
    const { data, meta } = await getTaskListApi({ projectId, page: page.value, pageSize: 10 })
    taskList.value = data
    total.value = meta.total
  } catch { /* ignore */ }
}

const resetCreateForm = () => {
  createFormRef.value?.resetFields()
  Object.assign(createForm, { taskName: '', annotateType: '', sampleCount: null, unitPrice: null, deadline: '', qaStandard: '' })
}

const openCreateTask = () => { createVisible.value = true }

const submitCreate = async () => {
  try { await createFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    await createTaskApi({ ...createForm, projectId })
    ElMessage.success('任务草稿已创建')
    createVisible.value = false
    loadTasks()
  } finally { actionLoading.value = false }
}

const handleTaskDelete = async (row) => {
  try { await ElMessageBox.confirm(`确认删除「${row.taskName}」？`, '删除任务', { type: 'warning' }) } catch { return }
  actionLoading.value = true
  try { await deleteTaskApi(row.id); ElMessage.success('已删除'); loadTasks() } finally { actionLoading.value = false }
}

onMounted(loadDetail)
</script>

<style scoped>
.page-head { margin-bottom: 16px; }
.info-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.header-actions { display: flex; gap: 10px; }
.pagination-wrap { margin-top: 16px; display: flex; justify-content: flex-end; }
</style>
