<template>
  <div>
    <el-drawer v-model="visible" :size="drawerSize" :title="detail ? `结算确认单 ${detail.billNo}` : '结算确认单'">
      <div v-loading="loading" class="detail-wrap">
        <template v-if="detail">
          <el-alert v-if="detail.status === 'REJECTED'" type="error" :closable="false" show-icon class="mb12"
            :title="`已被驳回：${detail.rejectReason}`" />

          <!-- 确认链进度 -->
          <el-steps :active="activeStep" :simple="isNarrow" align-center finish-status="success" class="mb16">
            <el-step title="供应商提交" :description="detail.createdByName" />
            <el-step v-for="st in detail.stages" :key="st.key" :title="st.label" :description="st.who || ''" :status="stepStatus(st)" />
          </el-steps>

          <el-descriptions :column="descColumns" border size="small" class="mb16">
            <el-descriptions-item label="所属项目">{{ detail.projectName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="批次名称">{{ detail.batchName }}</el-descriptions-item>
            <el-descriptions-item label="结算周期">{{ detail.period || '-' }}</el-descriptions-item>
            <el-descriptions-item label="供应商">{{ detail.supplierName }}</el-descriptions-item>
            <el-descriptions-item label="导入方式">{{ importModeText(detail.importMode) }}</el-descriptions-item>
            <el-descriptions-item label="来源文件">{{ detail.sourceFileName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="明细条数">{{ detail.itemCount }}</el-descriptions-item>
            <el-descriptions-item label="数量合计">{{ detail.totalQuantity }}</el-descriptions-item>
            <el-descriptions-item label="金额合计">
              <span class="money">¥{{ formatMoney(detail.totalAmount) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="重新提交次数">{{ detail.resubmitCount }}</el-descriptions-item>
            <el-descriptions-item label="提交人">{{ detail.createdByName }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ detail.createdAt }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="descColumns">{{ detail.remark || '-' }}</el-descriptions-item>
          </el-descriptions>

          <!-- 财务核算（每一单都经财务计算） -->
          <div class="sec-title">财务核算</div>
          <template v-if="detail.finance">
            <el-descriptions :column="descColumns" border size="small" class="mb16">
              <el-descriptions-item label="基础金额">¥{{ formatMoney(detail.finance.baseAmount) }}</el-descriptions-item>
              <el-descriptions-item label="扣款">¥{{ formatMoney(detail.finance.deduction) }}</el-descriptions-item>
              <el-descriptions-item label="税率">{{ detail.finance.taxRate }}%</el-descriptions-item>
              <el-descriptions-item label="扣款后金额">¥{{ formatMoney(detail.finance.netAmount) }}</el-descriptions-item>
              <el-descriptions-item label="税额">¥{{ formatMoney(detail.finance.taxAmount) }}</el-descriptions-item>
              <el-descriptions-item label="应付金额">
                <span class="money">¥{{ formatMoney(detail.finance.payableAmount) }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="核算人">{{ detail.finance.calculatedByName || '-' }}</el-descriptions-item>
              <el-descriptions-item label="核算时间">{{ detail.finance.calculatedAt || '-' }}</el-descriptions-item>
              <el-descriptions-item label="核算备注" :span="descColumns">{{ detail.finance.note || '-' }}</el-descriptions-item>
            </el-descriptions>
          </template>
          <el-alert v-else-if="detail.status === 'PENDING_FINANCE'" type="warning" :closable="false" show-icon class="mb16"
            title="尚未核算：财务需在「财务结算」页完成扣款/税率核算后才能确认通过。" />
          <el-empty v-else :image-size="50" description="尚未进入财务核算" class="mb16" />

          <!-- 附件（产出明细表原件） -->
          <template v-if="detail.attachments && detail.attachments.length">
            <div class="sec-title">附件（{{ detail.attachments.length }}）</div>
            <div class="attach-list mb16">
              <el-button v-for="a in detail.attachments" :key="a.storedName" size="small" :icon="Download" @click="downloadAttachment(a)">
                {{ a.originalName }}
              </el-button>
            </div>
          </template>

          <!-- 统结对比（柏川提交后自动生成，财务查看） -->
          <template v-if="detail.comparison">
            <div class="sec-title">统结对比（同项目：其他供应商 vs 统结方提交）</div>
            <div class="tip mb8">
              对比口径：同项目{{ detail.comparison.period ? ' + 同结算周期 ' + detail.comparison.period : '（本单未填结算周期，按整个项目汇总）' }}
            </div>
            <el-descriptions :column="descColumns" border size="small" class="mb16">
              <el-descriptions-item label="其他供应商合计" :span="descColumns">
                ¥{{ formatMoney(detail.comparison.base) }}（{{ detail.comparison.supplierCount }} 家<span
                  v-if="(detail.comparison.suppliers || []).length">：{{ (detail.comparison.suppliers || []).join('、') }}</span>）
              </el-descriptions-item>
              <el-descriptions-item label="统结方提交">¥{{ formatMoney(detail.comparison.submitted) }}</el-descriptions-item>
              <el-descriptions-item label="差异">¥{{ formatMoney(detail.comparison.difference) }}</el-descriptions-item>
              <el-descriptions-item label="增幅">
                <span :class="{ 'cmp-bad': detail.comparison.exceeded }">
                  {{ detail.comparison.ratePercent }}%（上限 {{ detail.comparison.limitPercent }}%）
                  <b v-if="detail.comparison.exceeded">· 超限</b>
                </span>
              </el-descriptions-item>
              <el-descriptions-item label="对比时间">{{ detail.comparison.comparedAt }}</el-descriptions-item>
              <el-descriptions-item label="提交人">{{ detail.comparison.comparedBy || '-' }}</el-descriptions-item>
            </el-descriptions>
          </template>

          <!-- 统结方节点：统一结算金额对比（3.5% 红线） -->
          <template v-if="isSettlementStage">
            <div class="sec-title">统一结算金额对比</div>
            <div class="settle-box mb16">
              <div class="sb-row">
                <span class="sb-label">各供应商确认金额合计</span>
                <b>¥{{ formatMoney(supplierTotal.total) }}</b>
                <span class="tip">
                  （{{ supplierTotal.supplierCount }} 家供应商 / {{ supplierTotal.billCount }} 张单<span
                    v-if="(supplierTotal.suppliers || []).length">：{{ (supplierTotal.suppliers || []).join('、') }}</span>）
                </span>
              </div>
              <div class="sb-row">
                <span class="sb-label">统结方提交总金额</span>
                <el-input-number v-model="submittedTotal" :min="0" :step="100" :controls="false" style="width:180px" placeholder="填写总金额" />
              </div>
              <div class="sb-result" :class="{ bad: increaseExceeded }">
                差异 ¥{{ formatMoney(increaseDiff) }} · 增幅
                <b>{{ increasePercent }}%</b>
                <span class="tip">（上限 {{ limitPercent }}%）</span>
                <span v-if="increaseExceeded"> — 超过上限，无法提交并已触发报警</span>
              </div>
            </div>
          </template>

          <!-- 已确认的统结金额（含确认/驳回记录） -->
          <template v-if="settlementRecord">
            <!-- 统结金额记录：当作一条 log 收起，点开看细节（含提交/对比时间） -->
            <el-collapse class="log-collapse mb16">
              <el-collapse-item name="settle">
                <template #title>
                  <span class="log-title">统结金额记录</span>
                  <span class="tip log-meta">
                    {{ settlementRecord.period || '-' }} · 提交 ¥{{ formatMoney(settlementRecord.submittedTotal) }}
                    · 提交时间 {{ settlementRecordAt || '-' }}
                  </span>
                </template>
                <el-descriptions :column="descColumns" border size="small">
                  <el-descriptions-item label="结算周期">{{ settlementRecord.period || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="供应商确认合计" :span="descColumns">
                    ¥{{ formatMoney(settlementRecord.supplierTotal) }}（{{ settlementRecord.supplierCount || 0 }} 家<span
                      v-if="(settlementRecord.suppliers || []).length">：{{ (settlementRecord.suppliers || []).join('、') }}</span>）
                  </el-descriptions-item>
                  <el-descriptions-item label="统结方提交金额">¥{{ formatMoney(settlementRecord.submittedTotal) }}</el-descriptions-item>
                  <el-descriptions-item label="差异">¥{{ formatMoney(settlementRecord.difference) }}</el-descriptions-item>
                  <el-descriptions-item label="增幅"> {{ settlementRecord.increasePercent }}%（上限 {{ settlementRecord.limitPercent }}%）</el-descriptions-item>
                  <el-descriptions-item label="提交人">{{ settlementRecordUser }}</el-descriptions-item>
                  <el-descriptions-item label="提交时间">{{ settlementRecordAt || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="重新提交时间">{{ settlementRecord.resubmittedAt || '-' }}</el-descriptions-item>
                </el-descriptions>
              </el-collapse-item>
            </el-collapse>
          </template>

          <!-- 确认记录 -->
          <!-- 催办记录 -->
          <template v-if="(detail.urges || []).length">
            <div class="sec-title">催办记录（{{ detail.urges.length }} 次）</div>
            <el-timeline class="mb16">
              <el-timeline-item v-for="(u, i) in [...detail.urges].reverse()" :key="i" :timestamp="u.at" type="warning" size="small">
                <b>{{ u.by }}</b> 催办「{{ u.stage }}」<span v-if="u.note" class="reject-text">说明：{{ u.note }}</span>
              </el-timeline-item>
            </el-timeline>
          </template>

          <div class="sec-title">确认记录</div>
          <el-timeline v-if="hasRecords" class="mb16">
            <el-timeline-item
              v-for="(r, i) in records"
              :key="i"
              :type="r.action === 'REJECT' ? 'danger' : 'success'"
              :timestamp="r.at"
            >
              <b>{{ r.stageLabel }}</b> · {{ r.userName }} {{ r.action === 'REJECT' ? '驳回' : '确认通过' }}
              <span v-if="r.comment" class="sub">（{{ r.comment }}）</span>
              <div v-if="r.reason" class="reject-text">驳回原因：{{ r.reason }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else :image-size="50" description="尚无确认记录" class="mb16" />

          <!-- 明细 -->
          <div class="sec-title">
            验收数据明细（{{ detail.items.length }} 条）
          </div>
          <el-table :data="detail.items" border size="small" max-height="360" show-summary :summary-method="summaryRow">
            <el-table-column label="#" prop="seq" :width="w(46)" />
            <el-table-column label="项目" prop="taskName" min-width="118" show-overflow-tooltip />
            <el-table-column v-if="itemHas('dataType')" label="数据类型" prop="dataType" :width="w(106)" show-overflow-tooltip />
            <el-table-column v-if="itemHas('acceptDate')" label="验收日期" prop="acceptDate" :width="w(98)" />
            <el-table-column label="数量" prop="quantity" :width="w(74)" />
            <el-table-column label="单位" prop="unit" :width="w(70)" />
            <el-table-column label="单价（RMB）" :width="w(104)">
              <template #default="s">{{ s.row.unitPrice || '-' }}</template>
            </el-table-column>
            <el-table-column label="总金额（RMB）" prop="amount" :width="w(118)">
              <template #default="s">{{ formatMoney(s.row.amount) }}</template>
            </el-table-column>
            <el-table-column v-if="itemHas('dataPath')" label="数据路径" prop="dataPath" min-width="128" show-overflow-tooltip />
            <el-table-column v-if="itemHas('remark')" label="备注" prop="remark" min-width="98" show-overflow-tooltip />
          </el-table>

          <!-- 成本中心比例与分摊金额（供应商提交内容，内部核对用） -->
          <div class="sec-title">
            成本中心比例（{{ (detail.costCenters || []).length }}）
          </div>
          <el-table v-if="(detail.costCenters || []).length" :data="detail.costCenters" border size="small" show-summary :summary-method="centerSummaryRow" class="mb16">
            <el-table-column label="成本中心" prop="name" min-width="140" />
            <el-table-column label="占比(%)" prop="ratio" :width="w(90)" align="right" />
            <el-table-column label="金额(元)" :width="w(110)" align="right">
              <template #default="s"><span class="money">{{ formatMoney(s.row.amount) }}</span></template>
            </el-table-column>
          </el-table>
          <el-empty v-else :image-size="50" description="未填写成本中心" class="mb16" />

          <!-- 操作区 -->
          <div class="detail-actions">
            <el-tooltip v-if="detail.permissions.canConfirm && detail.status === 'PENDING_FINANCE' && !detail.finance" content="请先在「财务结算」页完成核算" placement="top">
              <span>
                <el-button type="success" disabled>确认通过</el-button>
              </span>
            </el-tooltip>
            <!-- 统结方节点：导入/解析明细表 → 系统自动汇总金额提交（不再手填总金额） -->
            <el-button v-if="isSettlementStage" type="warning" :loading="acting" @click="openSettleDialog">导入统结数据并提交</el-button>
            <el-tooltip v-if="canResubmitSettlement" content="停在统结方/财务二次确认时，由统结方改正后重新提交" placement="top">
              <el-button type="warning" plain :loading="acting" @click="openSettleDialog">统结方重新提交</el-button>
            </el-tooltip>
            <el-tooltip v-if="isFinance2Stage && settlementExceeded" :content="`统结方提交较供应商合计增幅 ${settlementRate}% 超过上限 ${settlementLimit}%，请让统结方重新提交`" placement="top">
              <span><el-button type="success" disabled>确认通过</el-button></span>
            </el-tooltip>
            <el-tooltip v-else-if="detail.permissions.confirmBlockedReason" :content="detail.permissions.confirmBlockedReason" placement="top">
              <span><el-button type="success" disabled>确认通过</el-button></span>
            </el-tooltip>
            <template v-else-if="detail.permissions.canConfirm">
              <el-button type="success" :loading="acting" @click="confirmDialog = true">确认通过</el-button>
              <el-button type="danger" plain :loading="acting" @click="openReject">驳回</el-button>
            </template>
            <template v-if="detail.permissions.canResubmit">
              <el-button type="primary" :loading="acting" @click="onResubmit">修正完成，重新提交</el-button>
            </template>
            <template v-if="detail.permissions.canEdit">
              <el-button @click="editBillId = detail.id; uploadVisible = true">编辑</el-button>
            </template>
            <!-- 加急催办：单据没走完、且当前环节不是自己时可用 -->
            <el-tooltip v-if="canUrge" :content="urgeTip" placement="top">
              <el-button type="warning" plain :icon="Bell" :loading="urging" @click="onUrge">加急催办</el-button>
            </el-tooltip>
            <el-popconfirm v-if="detail.permissions.canDelete" title="确定删除该结算单？删除后不可恢复" @confirm="onDelete">
              <template #reference><el-button type="danger" text>删除</el-button></template>
            </el-popconfirm>
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- 统结数据导入（统结方节点/重新提交共用） -->
    <AcceptanceUploadDialog
      v-model="settleDialog"
      :project="detail.projectId ? { id: detail.projectId, name: detail.projectName } : null"
      settle-mode
      @settle-submit="onSettleSubmit"
    />

    <!-- 编辑验收数据（与项目管理页共用同一弹窗） -->
    <AcceptanceUploadDialog v-model="uploadVisible" :bill-id="editBillId" @submitted="onUploaded" />

    <!-- 确认通过 -->
    <el-dialog v-model="confirmDialog" title="确认通过" width="440px">
      <div class="dlg-tip">
        确认后流程将流转至「{{ nextStageLabel }}」<span v-if="!nextStageLabel">，四级确认全部完成</span>。
      </div>
      <el-input v-model="confirmComment" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="确认意见（选填）" />
      <template #footer>
        <el-button @click="confirmDialog = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="onConfirm">确认通过</el-button>
      </template>
    </el-dialog>

    <!-- 驳回 -->
    <el-dialog v-model="rejectDialog" title="驳回结算单" width="440px">
      <div class="dlg-tip">驳回后整单退回供应商，供应商修正并重新提交后将从「业务工程师确认」重新走流程。</div>
      <el-input v-model="rejectReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请填写驳回原因（必填）" />
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="acting" @click="onReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
// 结算确认单详情抽屉（含确认/驳回/编辑/重新提交/删除）
// 结算单列表页与项目管理页共用：供应商在项目页内即可查看自己单据的完整明细
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Bell } from '@element-plus/icons-vue'
import { Download } from '@element-plus/icons-vue'
import { BILL_STAGES, formatMoney, ROLE_TYPE, hasRole } from '@/utils/constants'
import { useUserStore } from '@/store/user'
import { getBillDetailApi, confirmBillApi, rejectBillApi, resubmitBillApi, deleteBillApi, urgeBillApi, resubmitSettlementApi } from '@/api/finance'
import { useResponsive } from '@/composables/useResponsive'
import { useDownload } from '@/composables/useDownload'
import AcceptanceUploadDialog from './AcceptanceUploadDialog.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  billId: { type: Number, default: null }
})
const emit = defineEmits(['update:modelValue', 'changed'])

const { isNarrow, descColumns, drawerSize, tableScale } = useResponsive()
const { downloadFile } = useDownload()

// 下载附件原件（复用通用文件下载路由）
async function downloadAttachment(a) {
  try {
    await downloadFile('/finance/attachments/download/' + encodeURIComponent(a.storedName), a.originalName || 'attachment')
  } catch (e) { ElMessage.error(e.message || '下载失败') }
}
const w = (px) => Math.round(px * tableScale.value)

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const detail = ref(null)
const userStore = useUserStore()
const loading = ref(false)
const acting = ref(false)
const urging = ref(false)
const confirmDialog = ref(false)
const confirmComment = ref('')
const rejectDialog = ref(false)
const rejectReason = ref('')
const editBillId = ref(null)
// 统结方节点：总金额与 3.5% 对比
const submittedTotal = ref(null)
const settleDialog = ref(false)
// 财务二次确认节点
const isFinance2Stage = computed(() => detail.value?.status === 'PENDING_FINANCE2' && !!detail.value?.permissions?.canConfirm)
const settlementCmp = computed(() => detail.value?.comparison || null)
const settlementExceeded = computed(() => !!settlementCmp.value?.exceeded)
const settlementRate = computed(() => settlementCmp.value?.ratePercent ?? 0)
const settlementLimit = computed(() => settlementCmp.value?.limitPercent ?? 3.5)
// 统结方重新提交：他本人的单据停在统结方/二次确认阶段时
const canResubmitSettlement = computed(() => {
  const s = detail.value?.status
  const me = hasRole(userStore.userInfo, ROLE_TYPE.SETTLEMENT)
  return me && (s === 'PENDING_SETTLEMENT' || s === 'PENDING_FINANCE2')
})

function openSettleDialog () { settleDialog.value = true }

async function onSettleSubmit (payload) {
  acting.value = true
  try {
    if (detail.value.status === 'PENDING_SETTLEMENT' && detail.value.permissions?.canConfirm) {
      await confirmBillApi(detail.value.id, '导入统结数据提交', undefined, payload)
      ElMessage.success('统结数据已提交，等待财务二次确认')
    } else {
      await resubmitSettlementApi(detail.value.id, payload)
      ElMessage.success('统结数据已重新提交')
    }
    await load()
  } catch { /* 错误提示由 request 统一处理 */ } finally { acting.value = false }
}
const uploadVisible = ref(false)

const hasRecords = computed(() => {
  if (!detail.value) return false
  return (detail.value.confirms?.length || 0) + (detail.value.rejections?.length || 0) > 0
})

const records = computed(() => {
  if (!detail.value) return []
  return [...(detail.value.confirms || []), ...(detail.value.rejections || [])]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
})

const nextStageLabel = computed(() => {
  if (!detail.value) return ''
  const next = BILL_STAGES[detail.value.currentStage + 1]
  return next ? next.label : ''
})

// el-steps 的 active：第0步为"供应商提交"，之后每完成一个确认节点 +1
const activeStep = computed(() => {
  if (!detail.value) return 0
  if (detail.value.status === 'APPROVED') return BILL_STAGES.length + 1
  return detail.value.currentStage + 1
})

function stepStatus(st) {
  if (!detail.value) return 'wait'
  if (st.done) return 'success'
  if (detail.value.status === 'REJECTED') return 'error'
  if (st.active) return 'process'
  return 'wait'
}

function importModeText(mode) {
  return { excel: 'Excel/CSV 导入', paste: '粘贴导入', manual: '手工录入' }[mode] || '-'
}

function summaryRow({ columns, data }) {
  const sums = []
  columns.forEach((col, index) => {
    if (index === 0) { sums[index] = '合计'; return }
    if (col.property === 'quantity') {
      sums[index] = data.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
      return
    }
    if (col.property === 'amount') {
      sums[index] = Number(data.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(10))
      return
    }
    sums[index] = ''
  })
  return sums
}

// 当前是否停在统结方节点（且轮到本人）
const isSettlementStage = computed(() => detail.value?.status === 'PENDING_SETTLEMENT' && !!detail.value?.permissions?.canConfirm)
const supplierTotal = computed(() => {
  const s = detail.value?.supplierConfirmedTotal || {}
  return { total: Number(s.supplierTotal) || 0, supplierCount: s.supplierCount || 0, billCount: s.billCount || 0 }
})
const limitPercent = computed(() => detail.value?.settlement?.limitPercent ?? detail.value?.increaseCheck?.limitPercent ?? 3.5)
// 明细里只有该项确实有数据时才显示该列（导入表没有的字段不再出现一列空值）
function itemHas (field) {
  return (detail.value.items || []).some(r => String(r[field] ?? '').trim() !== '')
}

const increaseDiff = computed(() => Number(((Number(submittedTotal.value) || 0) - supplierTotal.value.total).toFixed(2)))
const increasePercent = computed(() => {
  const base = supplierTotal.value.total
  if (!base) return 0
  return Number((increaseDiff.value / base * 100).toFixed(2))
})
const increaseExceeded = computed(() => supplierTotal.value.total > 0 && increasePercent.value > limitPercent.value)
// 已确认的统结金额（从确认记录里取）
const settlementConfirm = computed(() => (detail.value?.confirms || []).find(c => c.stageKey === 'SETTLEMENT' && c.settlement))
const settlementRecord = computed(() => settlementConfirm.value?.settlement || null)
const settlementRecordUser = computed(() => settlementConfirm.value?.userName || '-')
// 统结记录的提交时间（当作一条 log 展示）
const settlementRecordAt = computed(() => settlementRecord.value?.resubmittedAt || settlementConfirm.value?.at || '')

async function load() {
  if (!props.billId) return
  loading.value = true
  detail.value = null
  try {
    const { data } = await getBillDetailApi(props.billId)
    detail.value = data
  } catch { visible.value = false } finally { loading.value = false }
}

// 打开或切换单据时加载
watch([() => props.modelValue, () => props.billId], ([open]) => {
  if (open) { submittedTotal.value = null; load() }
})

async function refresh() {
  if (detail.value) await load()
  emit('changed')
}

async function onConfirm() {
  acting.value = true
  try {
    await confirmBillApi(detail.value.id, confirmComment.value, isSettlementStage.value ? Number(submittedTotal.value) : undefined)
    ElMessage.success('已确认通过')
    confirmDialog.value = false
    confirmComment.value = ''
    await refresh()
  } catch { /* 错误提示由 request 统一处理 */ } finally { acting.value = false }
}

// ===== 加急催办：催当前环节的处理人（后端 10 分钟内同一单只允许一次）=====
const canUrge = computed(() => {
  const s = detail.value.status
  return s !== 'APPROVED' && s !== 'REJECTED' && !detail.value.isMyTurn
})
const urgeTip = computed(() => {
  const n = (detail.value.urges || []).length
  return n ? `催办当前环节的处理人（已催办 ${n} 次）` : '催办当前环节的处理人，加急提醒（站内 + 飞书）'
})

async function onUrge () {
  let note = ''
  try {
    const r = await ElMessageBox.prompt('可填写催办说明（选填，最多 100 字）', '加急催办', {
      confirmButtonText: '发送催办',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：本单今天必须确认完成',
      inputValidator: (v) => String(v || '').length <= 100 || '最多 100 字',
      inputValue: ''
    })
    note = String(r.value || '').trim()
  } catch { return }
  urging.value = true
  try {
    await urgeBillApi(detail.value.id, note)
    ElMessage.success('已发送加急催办')
    await load()
  } catch { /* 错误提示由 request 统一处理（含 10 分钟内重复催办） */ } finally {
    urging.value = false
  }
}

function openReject() { rejectReason.value = ''; rejectDialog.value = true }

async function onReject() {
  if (!rejectReason.value.trim()) { ElMessage.warning('请填写驳回原因'); return }
  acting.value = true
  try {
    await rejectBillApi(detail.value.id, rejectReason.value.trim())
    ElMessage.success('已驳回')
    rejectDialog.value = false
    await refresh()
  } catch { /* ignore */ } finally { acting.value = false }
}

async function onResubmit() {
  try { await ElMessageBox.confirm('重新提交后确认流程将从「业务工程师确认」重新开始，确认？', '重新提交', { type: 'warning' }) } catch { return }
  acting.value = true
  try {
    await resubmitBillApi(detail.value.id)
    ElMessage.success('已重新提交')
    await refresh()
  } catch { /* ignore */ } finally { acting.value = false }
}

async function onUploaded() {
  editBillId.value = null
  await refresh()
}

// 成本中心合计行（占比合计应为 100%，金额合计应等于结算金额）
function centerSummaryRow({ columns, data }) {
  const sums = []
  columns.forEach((col, index) => {
    if (index === 0) { sums[index] = '合计'; return }
    if (col.property === 'ratio') {
      sums[index] = Number(data.reduce((s, r) => s + (Number(r.ratio) || 0), 0).toFixed(2)) + '%'
      return
    }
    if (col.property === 'amount' || col.label === '金额(元)') {
      sums[index] = '¥' + formatMoney(data.reduce((s, r) => s + (Number(r.amount) || 0), 0))
      return
    }
    sums[index] = ''
  })
  return sums
}

async function onDelete() {
  try {
    await deleteBillApi(detail.value.id)
    ElMessage.success('已删除')
    visible.value = false
    emit('changed')
  } catch { /* ignore */ }
}

defineExpose({ refresh })
</script>

<style scoped>
.detail-wrap { padding: 0 2px 24px; }
.attach-list { display: flex; gap: 8px; flex-wrap: wrap; }
.settle-box { padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
.sb-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.sb-label { font-size: 13px; color: var(--text-2); min-width: 150px; }
.sb-row b { font-size: 15px; color: var(--text-1); }
.sb-result { font-size: 13px; color: var(--text-2); }
.sb-result b { font-size: 15px; }
.sb-result.bad { color: var(--danger, #d64550); font-weight: 600; }
.mb12 { margin-bottom: 12px; }
.mb16 { margin-bottom: 14px; }
/* 明细页各模块标题：带主题色竖条的模块头，和正文明显区分开 */
.sec-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.3px;
  margin: 18px 0 12px;
  padding: 7px 12px 7px 10px;
  background: linear-gradient(90deg, var(--primary-bg) 0%, rgba(237, 242, 254, 0) 78%);
  border-left: 3px solid var(--primary);
  border-radius: 3px 8px 8px 3px;
}
.sec-title:first-child { margin-top: 4px; }
/* 统结金额记录：当 log 收起，省地方 */
.log-collapse :deep(.el-collapse-item__header) { height: auto; min-height: 40px; line-height: 1.4; padding: 4px 0; }
.log-collapse :deep(.el-collapse-item__content) { padding-bottom: 6px; }
.log-title { font-size: 14px; font-weight: 700; color: var(--text-1); margin-right: 8px; }
.log-meta { font-weight: 400; }
.money { color: #67c23a; font-weight: 700; }
.cmp-bad { color: var(--danger, #d64550); font-weight: 700; }
.sub { color: var(--text-3); }
.reject-text { color: #f56c6c; margin-top: 4px; }
.detail-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.dlg-tip { font-size: 13px; color: var(--text-3); margin-bottom: 10px; line-height: 1.6; }
</style>
