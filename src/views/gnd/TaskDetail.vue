<template>
  <div v-loading="loading">
    <el-page-header :content="task.measurementAreaName || '任务详情'" @back="$router.push('/gnd/tasks')" />

    <el-card shadow="never" class="mt">
      <el-descriptions :column="3" border>
        <el-descriptions-item label="测区名称">{{ task.measurementAreaName }}</el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <el-tag :type="GND_STATUS_TYPE[task.status] || 'info'">{{ GND_STATUS_MAP[task.status] || task.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="返修轮次">{{ task.repairRound }}</el-descriptions-item>
        <el-descriptions-item label="城市">{{ optionLabel('CITY', task.city) }}</el-descriptions-item>
        <el-descriptions-item label="车型">{{ optionLabel('VEHICLE_MODEL', task.vehicleModel) }}</el-descriptions-item>
        <el-descriptions-item label="数据类型">{{ optionLabel('DATA_TYPE', task.dataType) }}</el-descriptions-item>
        <el-descriptions-item label="源数据路径" :span="2">{{ task.sourceDataPath }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{ task.supplierName }}</el-descriptions-item>
        <el-descriptions-item label="任务索引路径" :span="2">{{ task.taskIndexPath }}</el-descriptions-item>
        <el-descriptions-item label="初填道路场景">{{ optionLabel('ROAD_SCENE', task.initialRoadScene) }}</el-descriptions-item>
        <el-descriptions-item label="版本号">{{ task.version || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ task.createdAt }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-row :gutter="12" class="mt">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>交付记录（每轮）</template>
          <el-empty v-if="!task.submissions || !task.submissions.length" description="暂无交付记录" :image-size="60" />
          <div v-for="s in (task.submissions || [])" :key="s.id" class="rec">
            <b>第 {{ s.round + 1 }} 轮</b> 里程 {{ s.supplierMileage }} km ·
            场景 {{ optionLabel('ROAD_SCENE', s.supplierRoadScene) }} ·
            提交 {{ s.submittedAt }}
            <div v-if="s.remark" class="rec-remark">{{ s.remark }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>验收记录（每轮）</template>
          <el-empty v-if="!task.acceptances || !task.acceptances.length" description="暂无验收记录" :image-size="60" />
          <div v-for="a in (task.acceptances || [])" :key="a.id" class="rec">
            <b>第 {{ a.round + 1 }} 轮</b>
            <el-tag size="small" :type="a.result === 'PASSED' ? 'success' : 'danger'">{{ a.result === 'PASSED' ? '通过' : '驳回' }}</el-tag>
            验收里程 {{ a.acceptanceMileage }} km
            <div v-if="a.rejectReason" class="rec-remark">驳回原因：{{ a.rejectReason }}</div>
            <div v-if="a.differenceExplanation" class="rec-remark">差异说明：{{ a.differenceExplanation }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" class="mt">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>状态流转</template>
          <el-timeline>
            <el-timeline-item v-for="h in (task.statusHistory || [])" :key="h.id" :timestamp="h.createdAt">
              {{ h.fromStatus ? GND_STATUS_MAP[h.fromStatus] : '创建' }} → {{ GND_STATUS_MAP[h.toStatus] || h.toStatus }}
              <div v-if="h.remark" class="rec-remark">{{ h.remark }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>字段修改历史</template>
          <el-empty v-if="!(task.fieldHistory || []).length" description="暂无字段修改" :image-size="60" />
          <div v-for="f in (task.fieldHistory || [])" :key="f.id" class="rec">
            {{ f.fieldName }}：{{ f.oldValue || '(空)' }} → {{ f.newValue || '(空)' }}
            <div class="rec-remark">{{ f.createdAt }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt actions">
      <template #header>当前环节操作</template>
      <el-button v-if="canReceive" type="success" @click="doReceive">接收任务</el-button>
      <el-button v-if="canSubmit" type="success" @click="openSubmit">提交成果</el-button>
      <el-button v-if="canCancelSubmit" @click="doCancelSubmit">撤回提交</el-button>
      <el-button v-if="canOptStart" type="warning" @click="doOpt('start')">开始优化</el-button>
      <el-button v-if="canOptStart" @click="doOpt('skip')">无需优化</el-button>
      <el-button v-if="canOptComplete" type="warning" @click="doOpt('complete')">优化完成</el-button>
      <el-button v-if="canAccept" type="primary" @click="openAccept('PASSED')">验收通过</el-button>
      <el-button v-if="canAccept" type="danger" @click="openAccept('REJECTED')">驳回返修</el-button>
      <el-button v-if="canRevert" @click="doRevert">撤销验收</el-button>
      <el-button v-if="canWarehouse" type="primary" @click="openWarehouse('QUALIFIED')">合格入库</el-button>
      <el-button v-if="canWarehouse" type="danger" @click="openWarehouse('UNQUALIFIED')">入库不合格</el-button>
      <el-button v-if="canRecover" type="primary" @click="doRecover">人工处理通过</el-button>
      <el-button v-if="canPerception" @click="openUsage">更新使用状态</el-button>
      <el-button v-if="canRepair" type="danger" @click="openRepair">申请返修</el-button>
      <el-button v-if="canRepairCancel" @click="doRepairCancel">撤回返修</el-button>
      <el-button v-if="canVoid" type="danger" @click="doVoid">作废任务</el-button>
      <span v-if="!hasAction" class="no-action">当前状态下无需操作</span>
    </el-card>

    <el-dialog v-model="submitVisible" title="提交成果" width="460px">
      <el-form label-width="110px">
        <el-form-item label="供应商里程(km)" required><el-input-number v-model="submitForm.supplierMileage" :precision="3" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="道路场景" required>
          <el-select v-model="submitForm.supplierRoadScene" style="width: 100%"><el-option v-for="o in options.ROAD_SCENE" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item label="交付备注"><el-input v-model="submitForm.remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="submitVisible = false">取消</el-button><el-button type="primary" @click="doSubmit">提交</el-button></template>
    </el-dialog>

    <el-dialog v-model="acceptVisible" :title="acceptMode === 'PASSED' ? '验收通过' : '驳回返修'" width="480px">
      <el-form label-width="110px">
        <el-form-item label="验收里程(km)" required><el-input-number v-model="acceptForm.acceptanceMileage" :precision="3" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="道路场景" required>
          <el-select v-model="acceptForm.acceptanceRoadScene" style="width: 100%"><el-option v-for="o in options.ROAD_SCENE" :key="o.code" :label="o.label" :value="o.code" /></el-select>
        </el-form-item>
        <el-form-item v-if="acceptMode === 'REJECTED'" label="驳回原因" required><el-input v-model="acceptForm.rejectReason" type="textarea" /></el-form-item>
        <el-form-item v-else label="差异说明"><el-input v-model="acceptForm.differenceExplanation" type="textarea" placeholder="里程与供应商差异超 5% 时必填" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="acceptVisible = false">取消</el-button><el-button type="primary" @click="doAccept">确认</el-button></template>
    </el-dialog>

    <el-dialog v-model="warehouseVisible" :title="warehouseMode === 'QUALIFIED' ? '合格入库' : '入库不合格'" width="420px">
      <el-form label-width="90px">
        <el-form-item label="入库备注"><el-input v-model="warehouseForm.remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="warehouseVisible = false">取消</el-button><el-button type="primary" @click="doWarehouse">确认</el-button></template>
    </el-dialog>

    <el-dialog v-model="repairVisible" title="申请返修" width="460px">
      <el-form label-width="90px">
        <el-form-item label="返修原因" required><el-input v-model="repairForm.repairReason" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="repairVisible = false">取消</el-button><el-button type="primary" @click="doRepair">提交</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import { GND_STATUS_MAP, GND_STATUS_TYPE } from '@/utils/constants'
import {
  gndTaskDetailApi, gndReceiveApi, gndSubmitApi, gndSubmitCancelApi, gndOptStartApi,
  gndOptSkipApi, gndOptCompleteApi, gndAcceptanceApi, gndAcceptanceRevertApi,
  gndWarehouseApi, gndWarehouseRecoverApi, gndPerceptionApi, gndRepairApi, gndRepairCancelApi,
  gndVoidApi, gndOptionsApi
} from '@/api/gnd'

const route = useRoute()
const userStore = useUserStore()
const loading = ref(false)
const task = ref({})
const options = reactive({ ROAD_SCENE: [], CITY: [], VEHICLE_MODEL: [], DATA_TYPE: [] })

function optionLabel(cat, code) { return (options[cat].find(o => o.code === code) || {}).label || code || '' }

async function load() {
  loading.value = true
  try { task.value = (await gndTaskDetailApi(route.params.id)).data } catch { /* 已提示 */ } finally { loading.value = false }
}

// ===== 操作权限（按角色 + 状态）=====
const st = computed(() => task.value.status)
const canReceive = computed(() => userStore.isGndSupplier && st.value === 'WAITING_ANNOTATION')
const canSubmit = computed(() => userStore.isGndSupplier && ['PROCESSING', 'REJECTED', 'REPAIR_REQUIRED'].includes(st.value))
const canCancelSubmit = computed(() => userStore.isGndSupplier && st.value === 'WAITING_OPTIMIZATION')
const canOptStart = computed(() => userStore.isOptimizer && st.value === 'WAITING_OPTIMIZATION')
const canOptComplete = computed(() => userStore.isOptimizer && st.value === 'OPTIMIZING')
const canAccept = computed(() => userStore.isAcceptor && st.value === 'WAITING_ACCEPTANCE')
const canRevert = computed(() => userStore.isTaixingAdmin && st.value === 'ACCEPTED')
const canWarehouse = computed(() => userStore.isTaixingAdmin && st.value === 'ACCEPTED')
const canRecover = computed(() => userStore.isTaixingAdmin && st.value === 'WAREHOUSE_REJECTED')
const canPerception = computed(() => userStore.isPerception && st.value === 'WAREHOUSED')
const canRepair = computed(() => userStore.isPerception && st.value === 'WAREHOUSED')
const canRepairCancel = computed(() => userStore.isPerception && st.value === 'REPAIR_REQUIRED')
const canVoid = computed(() => userStore.isTaixingAdmin && st.value === 'WAITING_ANNOTATION')
const hasAction = computed(() => canReceive.value || canSubmit.value || canCancelSubmit.value || canOptStart.value || canOptComplete.value || canAccept.value || canRevert.value || canWarehouse.value || canRecover.value || canPerception.value || canRepair.value || canRepairCancel.value || canVoid.value)

async function doReceive() { await gndReceiveApi(task.value.id); ElMessage.success('已接收'); load() }
async function doCancelSubmit() { await gndSubmitCancelApi(task.value.id); ElMessage.success('已撤回'); load() }
async function doVoid() {
  try {
    const { value } = await ElMessageBox.prompt('请输入作废原因', '作废任务', { confirmButtonText: '作废', inputPlaceholder: '作废原因（不可恢复）' })
    await gndVoidApi(task.value.id, { reason: value }); ElMessage.success('已作废'); load()
  } catch { /* 取消 */ }
}

// 提交成果
const submitVisible = ref(false)
const submitForm = reactive({ supplierMileage: 0, supplierRoadScene: '', remark: '' })
function openSubmit() { submitForm.supplierMileage = 0; submitForm.supplierRoadScene = ''; submitForm.remark = ''; submitVisible.value = true }
async function doSubmit() {
  if (!submitForm.supplierRoadScene) return ElMessage.warning('请选择道路场景')
  await gndSubmitApi(task.value.id, submitForm); ElMessage.success('已提交'); submitVisible.value = false; load()
}

// 优化
async function doOpt(mode) {
  if (mode === 'start') await gndOptStartApi(task.value.id, {})
  else if (mode === 'skip') await gndOptSkipApi(task.value.id, {})
  else await gndOptCompleteApi(task.value.id, {})
  ElMessage.success('操作成功'); load()
}

// 验收
const acceptVisible = ref(false)
const acceptMode = ref('PASSED')
const acceptForm = reactive({ acceptanceMileage: 0, acceptanceRoadScene: '', rejectReason: '', differenceExplanation: '' })
function openAccept(mode) {
  acceptMode.value = mode
  acceptForm.acceptanceMileage = 0
  const last = (task.value.submissions || []).at(-1)
  acceptForm.acceptanceRoadScene = last ? last.supplierRoadScene : task.value.initialRoadScene
  acceptForm.rejectReason = ''; acceptForm.differenceExplanation = ''
  acceptVisible.value = true
}
async function doAccept() {
  const payload = { acceptanceMileage: acceptForm.acceptanceMileage, acceptanceRoadScene: acceptForm.acceptanceRoadScene, result: acceptMode.value }
  if (acceptMode.value === 'REJECTED') payload.rejectReason = acceptForm.rejectReason
  else payload.differenceExplanation = acceptForm.differenceExplanation || null
  await gndAcceptanceApi(task.value.id, payload); ElMessage.success('已提交'); acceptVisible.value = false; load()
}
async function doRevert() {
  try {
    const { value } = await ElMessageBox.prompt('请输入撤销原因', '撤销验收', { confirmButtonText: '撤销', inputPlaceholder: '撤销原因' })
    await gndAcceptanceRevertApi(task.value.id, { reason: value }); ElMessage.success('已撤销'); load()
  } catch { /* 取消 */ }
}

// 入库
const warehouseVisible = ref(false)
const warehouseMode = ref('QUALIFIED')
const warehouseForm = reactive({ remark: '' })
function openWarehouse(mode) { warehouseMode.value = mode; warehouseForm.remark = ''; warehouseVisible.value = true }
async function doWarehouse() { await gndWarehouseApi(task.value.id, { result: warehouseMode.value, remark: warehouseForm.remark }); ElMessage.success('已处理'); warehouseVisible.value = false; load() }
async function doRecover() {
  try {
    const { value } = await ElMessageBox.prompt('处理说明', '人工处理通过', { confirmButtonText: '确认', inputPlaceholder: '处理说明' })
    await gndWarehouseRecoverApi(task.value.id, { remark: value }); ElMessage.success('已入库'); load()
  } catch { /* 取消 */ }
}

// 感知
async function openUsage() {
  try {
    const { value } = await ElMessageBox.prompt('使用状态 (UNUSED/IN_USE/USED)', '更新使用状态', { inputValue: (task.value.perception || {}).usageStatus || 'UNUSED' })
    const v = String(value).toUpperCase()
    if (!['UNUSED', 'IN_USE', 'USED'].includes(v)) return ElMessage.warning('请输入 UNUSED/IN_USE/USED')
    await gndPerceptionApi(task.value.id, { usageStatus: v }); ElMessage.success('已更新'); load()
  } catch { /* 取消 */ }
}
const repairVisible = ref(false)
const repairForm = reactive({ repairReason: '' })
function openRepair() { repairForm.repairReason = ''; repairVisible.value = true }
async function doRepair() {
  if (!repairForm.repairReason) return ElMessage.warning('请填写返修原因')
  await gndRepairApi(task.value.id, { repairReason: repairForm.repairReason }); ElMessage.success('已提交返修'); repairVisible.value = false; load()
}
async function doRepairCancel() {
  await gndRepairCancelApi(task.value.id); ElMessage.success('已撤回返修'); load()
}

onMounted(async () => {
  const cats = ['ROAD_SCENE', 'CITY', 'VEHICLE_MODEL', 'DATA_TYPE']
  for (const c of cats) { try { options[c] = (await gndOptionsApi(c)).data } catch {} }
  load()
})
</script>

<style scoped>
.mt { margin-top: 14px; }
.rec { padding: 6px 0; border-bottom: 1px dashed #eee; font-size: 13px; }
.rec-remark { color: #909399; font-size: 12px; margin-top: 2px; }
.actions :deep(.el-card__body) { display: flex; gap: 10px; flex-wrap: wrap; }
.no-action { color: #909399; }
</style>
