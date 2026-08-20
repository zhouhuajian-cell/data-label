<template>
  <div>
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="query.keyword" placeholder="测区名称" clearable style="width: 180px" @keyup.enter="load" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 150px">
          <el-option v-for="(label, code) in GND_STATUS_MAP" :key="code" :label="label" :value="code" />
        </el-select>
        <el-select v-model="query.city" placeholder="城市" clearable style="width: 130px">
          <el-option v-for="o in options.CITY" :key="o.code" :label="o.label" :value="o.code" />
        </el-select>
        <el-select v-if="userStore.isTaixingAdmin" v-model="query.supplier_id" placeholder="供应商" clearable style="width: 150px">
          <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-button type="primary" @click="load">查询</el-button>
        <el-button v-if="userStore.isTaixingAdmin" type="success" @click="createVisible = true">创建测区任务</el-button>
        <el-button v-if="userStore.isTaixingAdmin" @click="exportCsv">导出里程</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="measurementAreaName" label="测区名称" min-width="130" />
        <el-table-column label="城市" width="90">
          <template #default="{ row }">{{ optionLabel('CITY', row.city) }}</template>
        </el-table-column>
        <el-table-column label="车型" width="80">
          <template #default="{ row }">{{ optionLabel('VEHICLE_MODEL', row.vehicleModel) }}</template>
        </el-table-column>
        <el-table-column prop="supplierName" label="供应商" width="110" />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="GND_STATUS_TYPE[row.status] || 'info'" size="small">{{ GND_STATUS_MAP[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="supplierMileage" label="供应里程(km)" width="100" />
        <el-table-column prop="acceptanceMileage" label="验收里程(km)" width="100" />
        <el-table-column label="道路场景" width="120">
          <template #default="{ row }">{{ optionLabel('ROAD_SCENE', row.acceptanceRoadScene) }}</template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="170" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push('/gnd/task/' + row.id)">详情</el-button>
            <el-button v-if="canReceive(row)" link type="success" @click="receive(row)">接收</el-button>
            <el-button v-if="canSubmit(row)" link type="success" @click="openSubmit(row)">提交成果</el-button>
            <el-button v-if="canVoid(row)" link type="danger" @click="voidTask(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination class="pager" background layout="total, prev, pager, next" :total="total" :page-size="query.page_size" :current-page="query.page" @current-change="p => { query.page = p; load() }" />
    </el-card>

    <el-dialog v-model="createVisible" title="创建测区任务" width="560px">
      <el-form :model="createForm" label-width="110px">
        <el-form-item label="测区名称" required><el-input v-model="createForm.measurementAreaName" /></el-form-item>
        <el-form-item label="城市" required>
          <el-select v-model="createForm.city" style="width: 100%"><el-option v-for="o in options.CITY" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item label="车型" required>
          <el-select v-model="createForm.vehicleModel" style="width: 100%"><el-option v-for="o in options.VEHICLE_MODEL" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item label="版本号"><el-input v-model="createForm.version" /></el-form-item>
        <el-form-item label="数据类型" required>
          <el-select v-model="createForm.dataType" style="width: 100%"><el-option v-for="o in options.DATA_TYPE" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item label="源数据路径" required><el-input v-model="createForm.sourceDataPath" placeholder="如 /data/raw/xxx 或 D:/data/raw/xxx" /></el-form-item>
        <el-form-item label="任务索引路径" required><el-input v-model="createForm.taskIndexPath" /></el-form-item>
        <el-form-item label="道路场景" required>
          <el-select v-model="createForm.initialRoadScene" style="width: 100%"><el-option v-for="o in options.ROAD_SCENE" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item label="分配供应商" required>
          <el-select v-model="createForm.supplierId" style="width: 100%"><el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" /></el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createTask">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="submitVisible" title="提交成果" width="460px">
      <el-form label-width="110px">
        <el-form-item label="供应商里程(km)" required><el-input-number v-model="submitForm.supplierMileage" :precision="3" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="道路场景" required>
          <el-select v-model="submitForm.supplierRoadScene" style="width: 100%"><el-option v-for="o in options.ROAD_SCENE" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item label="交付备注"><el-input v-model="submitForm.remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="doSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import { GND_STATUS_MAP, GND_STATUS_TYPE } from '@/utils/constants'
import {
  gndTasksApi, gndCreateTaskApi, gndReceiveApi, gndSubmitApi, gndVoidApi,
  gndOptionsApi, gndSuppliersApi, gndExportApi
} from '@/api/gnd'

const userStore = useUserStore()
const loading = ref(false)
const rows = ref([])
const total = ref(0)
const query = reactive({ page: 1, page_size: 20, keyword: '', status: '', city: '', supplier_id: '' })
const suppliers = ref([])
const options = reactive({ CITY: [], VEHICLE_MODEL: [], DATA_TYPE: [], ROAD_SCENE: [] })

const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({ measurementAreaName: '', city: '', vehicleModel: '', version: '', dataType: '', sourceDataPath: '', taskIndexPath: '', initialRoadScene: '', supplierId: null })

const submitVisible = ref(false)
const submitting = ref(false)
const submitForm = reactive({ taskId: null, supplierMileage: 0, supplierRoadScene: '', remark: '' })

function optionLabel(cat, code) {
  return (options[cat].find(o => o.code === code) || {}).label || code || ''
}

async function load() {
  loading.value = true
  try {
    const { data, meta } = await gndTasksApi(query)
    rows.value = data
    total.value = meta.total
  } catch { /* 已提示 */ } finally { loading.value = false }
}

async function loadMeta() {
  const cats = ['CITY', 'VEHICLE_MODEL', 'DATA_TYPE', 'ROAD_SCENE']
  for (const c of cats) { try { options[c] = (await gndOptionsApi(c)).data } catch {} }
  if (userStore.isTaixingAdmin) { try { suppliers.value = (await gndSuppliersApi()).data } catch {} }
}

function canReceive(row) { return userStore.isGndSupplier && row.status === 'WAITING_ANNOTATION' }
function canSubmit(row) { return userStore.isGndSupplier && ['PROCESSING', 'REJECTED', 'REPAIR_REQUIRED'].includes(row.status) }
function canVoid(row) { return userStore.isTaixingAdmin && row.status === 'WAITING_ANNOTATION' }

async function receive(row) {
  await gndReceiveApi(row.id)
  ElMessage.success('已接收')
  load()
}

function openSubmit(row) {
  submitForm.taskId = row.id
  submitForm.supplierMileage = 0
  submitForm.supplierRoadScene = ''
  submitForm.remark = ''
  submitVisible.value = true
}

async function doSubmit() {
  if (!submitForm.supplierRoadScene) return ElMessage.warning('请选择道路场景')
  submitting.value = true
  try {
    await gndSubmitApi(submitForm.taskId, { supplierMileage: submitForm.supplierMileage, supplierRoadScene: submitForm.supplierRoadScene, remark: submitForm.remark })
    ElMessage.success('已提交')
    submitVisible.value = false
    load()
  } catch { /* 已提示 */ } finally { submitting.value = false }
}

async function voidTask(row) {
  try {
    const { value } = await ElMessageBox.prompt('请输入作废原因', '作废任务', { confirmButtonText: '作废', inputPlaceholder: '作废原因（不可恢复）' })
    await gndVoidApi(row.id, { reason: value })
    ElMessage.success('已作废')
    load()
  } catch { /* 取消 */ }
}

async function exportCsv() {
  try {
    await gndExportApi()
  } catch { /* 已提示 */ }
}

async function createTask() {
  creating.value = true
  try {
    await gndCreateTaskApi(createForm)
    ElMessage.success('创建成功')
    createVisible.value = false
    load()
  } catch { /* 已提示 */ } finally { creating.value = false }
}

onMounted(() => { load(); loadMeta() })
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
