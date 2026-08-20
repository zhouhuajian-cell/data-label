<template>
  <div class="task-detail" v-loading="loading">
    <el-page-header @back="$router.back()" content="任务详情" class="page-head" />

    <el-card class="info-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>基本信息</span>
          <div class="header-actions">
            <el-tag :type="getTaskStateType(taskInfo.state)" size="large">{{ getTaskStateText(taskInfo.state) }}</el-tag>

            <!-- 供应商操作 -->
            <el-button v-if="showAccept" type="primary" @click="onAccept">接单</el-button>
            <el-button v-if="showCompleteWork" type="primary" @click="onCompleteWork">完成作业</el-button>
            <el-button v-if="showSubmit" type="primary" :icon="Upload" @click="deliverVisible = true">提交交付</el-button>
            <el-button v-if="showResubmit" type="warning" :icon="Upload" @click="deliverVisible = true">修改后重新提交</el-button>

            <!-- 甲方操作 -->
            <el-button v-if="showReview" type="success" @click="reviewTaskVisible = true">质检验收</el-button>
            <el-button v-if="showDispatch" type="primary" @click="dispatchSingle">派发任务</el-button>
          </div>
        </div>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="任务ID">{{ taskInfo.id }}</el-descriptions-item>
        <el-descriptions-item label="任务名称">{{ taskInfo.taskName }}</el-descriptions-item>
        <el-descriptions-item label="标注类型">{{ taskInfo.annotateType }}</el-descriptions-item>
        <el-descriptions-item label="样本数量">{{ taskInfo.sampleCount }}帧</el-descriptions-item>
        <el-descriptions-item label="单价">{{ taskInfo.unitPrice ? '¥' + taskInfo.unitPrice + '/帧' : '-' }}</el-descriptions-item>
        <el-descriptions-item label="总金额">{{ taskInfo.totalPrice ? '¥' + taskInfo.totalPrice : '-' }}</el-descriptions-item>
        <el-descriptions-item label="截止时间">{{ taskInfo.deadline }}</el-descriptions-item>
        <el-descriptions-item label="承接供应商">{{ taskInfo.supplierName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="返工次数">{{ taskInfo.currentRework || 0 }}次</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-if="taskInfo.dataPackage" class="package-card" shadow="hover">
      <template #header><div class="card-header"><span>数据包</span><el-button type="primary" size="small" @click="downloadPackage">下载原始数据</el-button></div></template>
      <div class="package-info"><span>文件名：{{ taskInfo.dataPackage.fileName }}</span><span>大小：{{ formatSize(taskInfo.dataPackage.size) }}</span></div>
    </el-card>

    <el-card class="state-card" shadow="hover">
      <template #header>状态流转</template>
      <el-timeline>
        <el-timeline-item v-for="(item, idx) in stateLog" :key="idx" :timestamp="item.time" :type="item.type">{{ item.content }}</el-timeline-item>
      </el-timeline>
    </el-card>

    <el-card class="version-card" shadow="hover">
      <template #header>提交历史与质检记录</template>
      <el-table :data="versionList" border size="small">
        <el-table-column label="版本号" prop="version" width="100" />
        <el-table-column label="提交时间" prop="submitTime" width="170" />
        <el-table-column label="提交人" prop="submitUser" width="110" />
        <el-table-column label="质检得分" prop="score" width="90"><template #default="s"><span :style="{color: s.row.score >= 90 ? '#67c23a' : s.row.score >= 80 ? '#e6a23c' : '#f56c6c', fontWeight:'bold'}">{{ s.row.score || '-' }}</span></template></el-table-column>
        <el-table-column label="质检结果" width="110">
          <template #default="s">
            <el-tag v-if="s.row.pass === true" type="success">验收通过</el-tag>
            <el-tag v-else-if="s.row.pass === false" type="danger">驳回整改</el-tag>
            <span v-else style="color:#c0c4cc">待质检</span>
          </template>
        </el-table-column>
        <el-table-column label="质检意见" prop="reviewComment" min-width="150" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-card class="items-card" shadow="hover" v-if="items.length">
      <template #header><span>任务明细（{{ items.length }} 条）</span></template>
      <el-table :data="items" border size="small" max-height="320">
        <el-table-column label="明细名称" prop="itemName" min-width="180" show-overflow-tooltip />
        <el-table-column label="数据上传路径" min-width="220" show-overflow-tooltip><template #default="s">{{ s.row.uploadPath || '-' }}</template></el-table-column>
        <el-table-column label="状态" width="150"><template #default="s"><el-select :model-value="s.row.status" size="small" @change="(v) => onChangeItemStatus(s.row, v)"><el-option v-for="(label, code) in editableItemStates" :key="code" :label="label" :value="code" /></el-select></template></el-table-column>
        <el-table-column label="问题截图" width="150">
          <template #default="s">
            <div v-if="(s.row.rejectImages || []).length" style="display:flex;gap:4px">
              <el-image v-for="img in s.row.rejectImages" :key="img.storedName" :src="imgUrl(img.storedName)" :preview-src-list="s.row.rejectImages.map(i => imgUrl(i.storedName))" :initial-index="0" style="width:44px;height:44px;border-radius:4px;cursor:pointer" fit="cover" preview-teleported>
                <template #error><div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#c0c4cc;background:#f5f7fa;border-radius:4px">图</div></template>
              </el-image>
            </div>
            <span v-else style="color:#c0c4cc">-</span>
          </template>
        </el-table-column>
        <el-table-column label="驳回备注" min-width="160" show-overflow-tooltip><template #default="s"><span :style="s.row.rejectNote ? {color:'#f56c6c'} : {color:'#c0c4cc'}">{{ s.row.rejectNote || '-' }}</span></template></el-table-column>
        <el-table-column label="返修次数" width="90"><template #default="s"><el-tag v-if="s.row.reworkCount" size="small" type="warning">第{{ s.row.reworkCount }}次返修</el-tag><span v-else style="color:#c0c4cc">-</span></template></el-table-column>
      </el-table>
    </el-card>

    <el-card class="norm-card" shadow="hover">
      <template #header>标注规范</template>
      <div class="norm-content" v-html="taskInfo.qaStandard"></div>
    </el-card>

    <!-- 提交交付弹窗 -->
    <DeliverModal v-model:visible="deliverVisible" :task-info="taskInfo" :items="items" @success="loadDetail" />

    <!-- 质检验收弹窗 -->
    <el-dialog v-model="reviewTaskVisible" title="质检验收" width="480px">
      <el-form ref="reviewFormRef" :model="reviewForm" :rules="reviewRules" label-width="80px">
        <el-form-item label="任务">{{ taskInfo.taskName }}</el-form-item>
        <el-form-item label="结果" prop="pass">
          <el-radio-group v-model="reviewForm.pass"><el-radio-button :value="true">通过</el-radio-button><el-radio-button :value="false">驳回</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item label="分数" prop="score"><el-input-number v-model="reviewForm.score" :min="0" :max="100" style="width:100%" /></el-form-item>
        <el-form-item label="驳回原因" v-if="!reviewForm.pass" prop="rejectReason">
          <el-select v-model="reviewForm.rejectReason" placeholder="选择驳回原因" style="width:100%">
            <el-option v-for="t in REJECT_ERROR_TYPES" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="意见" prop="comment">
          <el-input v-model="reviewForm.comment" type="textarea" :rows="2" :placeholder="reviewForm.pass ? '选填' : '驳回原因必填（至少5字）'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewTaskVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="confirmReview">提交验收</el-button>
      </template>
    </el-dialog>

    <!-- 派发弹窗 -->
    <el-dialog v-model="dispatchVisible" title="派发任务" width="480px">
      <el-form ref="dispatchFormRef" :model="dispatchForm" :rules="{ supplierId: [{ required: true, message: '请选择供应商', trigger: 'change' }] }" label-width="80px">
        <el-form-item label="任务">{{ taskInfo.taskName }}</el-form-item>
        <el-form-item label="供应商" prop="supplierId">
          <el-select v-model="dispatchForm.supplierId" placeholder="选择供应商" style="width:100%" @focus="loadSuppliers">
            <el-option v-for="s in supplierList" :key="s.id" :label="s.name + ' | 质量分' + s.qualityScore" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="立即开工"><el-switch v-model="dispatchForm.immediateStart" active-text="派发后立即开工" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="confirmDispatch">确认派发</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDownload } from '@/composables/useDownload'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { getTaskDetailApi, acceptTaskApi, completeWorkApi, dispatchTaskApi, reviewTaskApi, getSupplierListApi } from '@/api/tasks'
import { useUserStore } from '@/store/user'
import { getTaskStateText, getTaskStateType, REJECT_ERROR_TYPES, ITEM_STATUS_MAP } from '@/utils/constants'
import DeliverModal from '@/components/task/DeliverModal.vue'
import { updateTaskItemApi } from '@/api/items'

const route = useRoute()
const router = useRouter()
const { downloadFile: downloadBlob } = useDownload()
const userStore = useUserStore()
const loading = ref(false)
const actionLoading = ref(false)

const taskInfo = ref({})
const stateLog = ref([])
const versionList = ref([])
const items = ref([])
const editableItemStates = {
  pending: '待标注', annotating: '标注中', annotated: '待供应商质检', submitted: '已提交',
  failed: '失败'
}
const imgUrl = (storedName) => '/api/files/download/' + storedName + '?token=' + (localStorage.getItem('token') || '')
const onChangeItemStatus = async (row, status) => {
  try { await updateTaskItemApi(taskInfo.value.id, row.id, { status }); row.status = status; ElMessage.success('明细状态已更新') } catch { ElMessage.error('状态更新失败') }
}
const supplierList = ref([])

const deliverVisible = ref(false)
const reviewTaskVisible = ref(false)
const dispatchVisible = ref(false)

// 角色/状态 → 按钮显隐
const isSupplier = computed(() => userStore.userInfo.roleType === 3)
const isBuyer = computed(() => [1, 2].includes(userStore.userInfo.roleType))

const showAccept = computed(() => isSupplier.value && taskInfo.value.state === 'UNASSIGNED' && taskInfo.value.supplierId === userStore.userInfo.supplierId)
const showCompleteWork = computed(() => isSupplier.value && taskInfo.value.state === 'ANNOTATING')
const showSubmit = computed(() => isSupplier.value && taskInfo.value.state === 'VENDOR_QA')
const showResubmit = computed(() => isSupplier.value && taskInfo.value.state === 'REJECTED')
const showReview = computed(() => isBuyer.value && taskInfo.value.state === 'CLIENT_QA')
const showDispatch = computed(() => isBuyer.value && ['UNASSIGNED', 'REJECTED'].includes(taskInfo.value.state))

// 质检验收
const reviewFormRef = ref(null)
const reviewForm = ref({ pass: true, score: null, rejectReason: '', comment: '' })
const reviewRules = {
  score: [{ required: true, message: '请输入分数' }],
  rejectReason: [{ required: true, message: '请选择驳回原因', trigger: 'change' }],
  comment: [{ validator: (r, v, cb) => { if (!reviewForm.value.rejectReason && !reviewForm.value.pass && (!v || v.length < 5)) cb(new Error('驳回需填写原因（至少5字）')); else cb() }, trigger: 'blur' }]
}

const confirmReview = async () => {
  try { await reviewFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    const payload = { pass: reviewForm.value.pass, score: reviewForm.value.score, comment: reviewForm.value.comment, rejectReason: reviewForm.value.rejectReason }
    await reviewTaskApi(taskInfo.value.id, payload)
    ElMessage.success(reviewForm.value.pass ? '验收通过' : '已驳回，供应商可重新提交')
    reviewTaskVisible.value = false
    loadDetail()
  } finally { actionLoading.value = false }
}

// 派发
const dispatchFormRef = ref(null)
const dispatchForm = ref({ supplierId: null, immediateStart: true })
const dispatchSingle = () => {
  dispatchForm.value = { supplierId: null, immediateStart: true }
  dispatchVisible.value = true
}
const confirmDispatch = async () => {
  try { await dispatchFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    await dispatchTaskApi(taskInfo.value.id, dispatchForm.value)
    ElMessage.success('已派发')
    dispatchVisible.value = false
    loadDetail()
  } finally { actionLoading.value = false }
}

// 接单/完成作业
const onAccept = async () => { try { await acceptTaskApi(taskInfo.value.id); ElMessage.success('已接单，进入标注作业'); loadDetail() } catch {} }
const onCompleteWork = async () => { try { await completeWorkApi(taskInfo.value.id); ElMessage.success('作业完成，可提交质检'); loadDetail() } catch {} }

const loadSuppliers = async () => { if (!supplierList.value.length) try { const { data } = await getSupplierListApi(); supplierList.value = data } catch {} }

const downloadPackage = async () => {
  const pkg = taskInfo.value.dataPackage
  if (!pkg?.storedName) return
  try {
    await downloadBlob('/files/download/' + pkg.storedName, pkg.fileName || 'data.zip')
  } catch { ElMessage.error('下载失败') }
}

const downloadFile = (row) => {
  if (!row.id || !row.storedName) { ElMessage.warning('该版本未上传文件'); return }
  downloadBlob('/submissions/' + row.id + '/download', row.fileName || 'submission_' + row.id + '.zip')
    .catch(() => ElMessage.error('下载失败'))
}

const formatSize = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0; let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return size.toFixed(1) + ' ' + units[i]
}

const loadDetail = async () => {
  const taskId = route.params.id
  if (!taskId) return
  loading.value = true
  try {
    const { data } = await getTaskDetailApi(taskId)
    taskInfo.value = data.task
    stateLog.value = data.stateLog
    versionList.value = data.versions
    items.value = data.items || []
  } finally { loading.value = false }
}

watch(() => route.params.id, (newId) => { if (newId && newId !== route.params.id) loadDetail() })
onMounted(loadDetail)
</script>

<style scoped>
.page-head { margin-bottom: 16px; }
.info-card, .state-card, .version-card, .norm-card, .package-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.norm-content { line-height: 2; color: #606266; }
.package-info { display: flex; gap: 20px; color: #606266; }
</style>
