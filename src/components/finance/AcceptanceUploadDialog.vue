<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="880px"
    top="5vh"
    :close-on-click-modal="false"
    @closed="onClosed"
  >
    <div class="upload-dialog">
      <div class="subject">
        <span class="subject-label">所属项目</span>
        <span class="subject-name">{{ projectName || '—' }}</span>
        <span class="tip">验收数据按项目归集，结算以项目为单位汇总</span>
      </div>

      <el-form label-width="86px" size="default" class="mb14" label-position="top">
        <el-row :gutter="14">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="批次名称" required>
              <el-input v-model="form.batchName" placeholder="如：2026-08 验收数据" maxlength="60" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="结算周期">
              <el-date-picker v-model="form.period" type="month" value-format="YYYY-MM" placeholder="选择月份" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="供应商">
              <!-- 供应商身份以「姓名」为准：供应商账号固定显示自身姓名，甲方PM 才可代选 -->
              <el-input v-if="!isPm" :model-value="userStore.userInfo.userName" disabled placeholder="本账号姓名" style="width:100%" />
              <el-select v-else v-model="form.supplierName" placeholder="选择供应商（姓名）" clearable filterable allow-create style="width:100%">
                <el-option v-for="name in supplierOptions" :key="name" :label="name" :value="name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="24" :md="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" maxlength="200" placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <!-- 附件留存（产出明细表原件） -->
      <!-- 附件留存（独立入口）：明细数据附件，原样留存不解析 -->
      <div class="sec-title">
        附件（明细数据）
        <span class="tip">原样留存，不解析；提交后可在单据详情下载</span>
      </div>
      <div class="attach-box">
        <input ref="attachInputRef" type="file" accept=".xlsx,.xls,.csv,.txt,.pdf,.zip,.rar,.7z,.png,.jpg,.jpeg" class="hidden-file" @change="onAttachChange">
        <el-button plain size="small" :icon="Upload" :loading="attaching" @click="attachInputRef?.click()">上传附件</el-button>
        <el-tag v-for="a in attachments" :key="a.storedName" size="small" closable @close="removeAttachment(a.storedName)">
          {{ a.originalName }}
        </el-tag>
        <span v-if="!attachments.length" class="tip">尚未上传附件（可选）</span>
      </div>

      <!-- 导入区 -->
      <el-tabs v-model="importTab" class="mb8">
        <el-tab-pane label="Excel / CSV 导入" name="excel">
          <div class="import-box">
            <input ref="fileRef" type="file" accept=".xlsx,.xls,.csv,.txt" class="hidden-file" @change="onFileChange">
            <el-button type="primary" plain :icon="Upload" :loading="parsing" @click="fileRef?.click()">选择文件并解析</el-button>
            <el-button text :icon="Download" @click="downloadTemplate">下载模板</el-button>
            <span class="tip">支持 .xlsx / .xls / .csv，自动识别表头；解析结果可在下方表格中修正</span>
          </div>
        </el-tab-pane>
        <el-tab-pane label="粘贴导入" name="paste">
          <div class="import-box col">
            <div class="tip">从 Excel 直接复制粘贴（含表头自动跳过）。列顺序：{{ columnsHint }}</div>
            <el-input v-model="pasteText" type="textarea" :rows="4" placeholder="序号	项目	单位	数量	单价（RMB）	总金额（RMB）" />
            <div>
              <el-button type="primary" plain :loading="parsing" @click="onPasteParse">解析粘贴内容</el-button>
              <el-button text @click="pasteText = ACCEPTANCE_SAMPLE">填入示例</el-button>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="手工录入" name="manual">
          <div class="import-box">
            <el-button plain :icon="Plus" @click="addRow">新增一行</el-button>
            <span class="tip">适合少量数据；数量与单价填写后自动计算金额</span>
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- 明细表 -->
      <div class="sec-title">
        验收数据明细（{{ rows.length }} 条）
        <span class="tip" v-if="rows.length">· 可直接修改单元格内容</span>
      </div>
      <el-table :data="rows" border size="small" max-height="300">
        <el-table-column label="#" type="index" :width="w(44)" />
        <el-table-column label="项目 *" min-width="170">
          <template #default="s"><el-input v-model="s.row.taskName" size="small" placeholder="必填" /></template>
        </el-table-column>
        <el-table-column label="单位" :width="w(110)">
          <template #default="s">
            <el-select v-model="s.row.unit" size="small" filterable allow-create default-first-option placeholder="帧/条/km" style="width:100%">
              <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="数量" :width="w(110)">
          <template #default="s"><el-input-number v-model="s.row.quantity" size="small" :min="0" :controls="false" style="width:100%" @change="recalc(s.row)" /></template>
        </el-table-column>
        <el-table-column label="单价（RMB）" :width="w(120)">
          <template #default="s"><el-input-number v-model="s.row.unitPrice" size="small" :min="0" :controls="false" style="width:100%" @change="recalc(s.row)" /></template>
        </el-table-column>
        <el-table-column label="总金额（RMB）" :width="w(140)">
          <template #default="s"><span class="money">{{ formatMoney(s.row.amount) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" :width="w(62)" fixed="right">
          <template #default="s"><el-button text type="danger" size="small" @click="removeRow(s.$index)">删除</el-button></template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!rows.length" :image-size="60" description="尚未导入数据：请选择文件、粘贴内容或手工新增" />

      <div class="totals" v-if="rows.length">
        合计：<b>{{ rows.length }}</b> 条 · 数量 <b>{{ totalQuantity }}</b> · 总金额 <b class="money">¥{{ formatMoney(totalAmount) }}</b>
      </div>

      <!-- 成本中心金额（占比由金额自动算） -->
      <div class="sec-title">
        成本中心金额 <span class="req">*</span>
        <span class="tip">填金额即可，占比自动计算；金额合计必须等于单据总金额（例：M57项目 ¥600 / G91项目 ¥400）</span>
      </div>
      <el-table :data="costCenters" border size="small" class="mb8">
        <el-table-column label="成本中心" min-width="180">
          <template #default="s">
            <el-select v-model="s.row.name" size="small" filterable allow-create default-first-option clearable
              placeholder="选择或输入成本中心" style="width:100%">
              <el-option v-for="n in COST_CENTER_OPTIONS" :key="n" :label="n" :value="n" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="金额（RMB）" :width="w(170)">
          <template #default="s"><el-input-number v-model="s.row.amount" size="small" :min="0" :controls="false" style="width:100%" /></template>
        </el-table-column>
        <el-table-column label="占比(%)" :width="w(110)" align="right">
          <template #default="s"><span class="money">{{ centerRatio(s.row) }}%</span></template>
        </el-table-column>
        <el-table-column label="操作" :width="w(66)" fixed="right">
          <template #default="s"><el-button text type="danger" size="small" @click="removeCostCenter(s.$index)">删除</el-button></template>
        </el-table-column>
      </el-table>
      <div class="center-bar">
        <el-button plain size="small" :icon="Plus" @click="addCostCenter">新增成本中心</el-button>
        <span class="center-total" :class="{ bad: costCenterMismatch && costCenters.length > 0 }">
          金额合计 ¥{{ formatMoney(costCenterAmountTotal) }} / 单据总金额 ¥{{ formatMoney(totalAmount) }}
          <span v-if="costCenters.length && costCenterMismatch">
            （必须相等，当前差 ¥{{ formatMoney(costCenterDiff) }}）
          </span>
          <span v-else-if="costCenters.length">（占比合计 {{ costCenterRatioTotal }}%）</span>
        </span>
      </div>

      <el-alert type="info" :closable="false" show-icon class="mb8"
        title="确认流程：业务工程师 → 财务 → 统结方提交 → 财务二次确认 → 负责人 → 算法 → OA 结算；任一步驳回后整单退回，修正后重新提交将从第一节点重新流转。" />
    </div>

    <template #footer>
      <span v-if="submitBlockedReason" class="block-tip">{{ submitBlockedReason }}</span>
      <el-button @click="visible = false">取消</el-button>
      <el-tooltip :disabled="!submitBlockedReason" :content="submitBlockedReason" placement="top">
        <span>
          <el-button type="primary" :loading="submitting" :disabled="!!submitBlockedReason" @click="onSubmit">
            {{ isEdit ? '保存修改' : '提交确认' }}
          </el-button>
        </span>
      </el-tooltip>
    </template>
  </el-dialog>
</template>

<script setup>
// 上传/编辑验收数据：统一以弹窗形式在「项目管理」页内使用（项目上下文由 props 传入）
// 也支持结算单列表页的"编辑"入口（传入 billId）
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, Download, Plus } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { ROLE_TYPE, formatMoney, hasRole, COST_CENTER_OPTIONS } from '@/utils/constants'
import { ACCEPTANCE_COLUMNS, ACCEPTANCE_SAMPLE, parseAcceptanceLines, acceptanceRowAmount } from '@/utils/csv'
import { parseAcceptanceFileApi, createBillApi, updateBillApi, getBillDetailApi, uploadAttachmentApi } from '@/api/finance'
import { listSupplierNamesApi } from '@/api/finance'
import { useResponsive } from '@/composables/useResponsive'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 统结方模式：同一套「导入/解析明细」界面，提交的是统结数据（走统结方节点，不建新单）
  settleMode: { type: Boolean, default: false },
  // 项目上下文：项目页打开时固定传入
  project: { type: Object, default: null },
  // 编辑既有结算单（结算单列表页使用）
  billId: { type: Number, default: null }
})
const emit = defineEmits(['update:modelValue', 'submitted'])

const userStore = useUserStore()
const { tableScale } = useResponsive()
const w = (px) => Math.round(px * tableScale.value)

const isPm = computed(() => hasRole(userStore.userInfo, ROLE_TYPE.CLIENT_PM))
const isEdit = computed(() => !!props.billId)
const columnsHint = ACCEPTANCE_COLUMNS.join('\t')
const projectName = computed(() => props.project?.name || '')
const dialogTitle = computed(() => (isEdit.value ? `编辑结算确认单 ${form.billNo || ''}` : `上传验收数据 · ${projectName.value || ''}`))

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const importTab = ref('excel')
const fileRef = ref(null)
const parsing = ref(false)
const submitting = ref(false)
const pasteText = ref('')
const supplierOptions = ref([])
const sourceFileName = ref('')
const importMode = ref('manual')

const form = reactive({ batchName: '', period: '', remark: '', supplierName: '', billNo: '' })
// 编辑既有结算单时的归属项目（列表页编辑没有 project prop，需从单据读取）
const editProjectId = ref(null)
const rows = ref([])
// 成本中心比例（第三段）：合计必须 100%
const costCenters = ref([])
// 附件留存（②上传附件，为产出明细表）
const attachments = ref([])
const attachInputRef = ref(null)
const attaching = ref(false)
const UNIT_OPTIONS = ['条', '帧', 'km', '包', '张', '个', '份']

const totalQuantity = computed(() => Number(rows.value.reduce((s, r) => s + (Number(r.quantity) || 0), 0).toFixed(3)))
const totalAmount = computed(() => Number(rows.value.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(10)))

function recalc(row) { row.amount = acceptanceRowAmount(row) }

// 防呆：两个文件不齐不让提交
//  ① 明细数据附件（留存件）② 可解析的验收数据明细（解析/录入出来的行）
const submitBlockedReason = computed(() => {
  const missing = []
  if (!attachments.value.length) missing.push('「附件（明细数据）」')
  if (!rows.value.length) missing.push('验收数据明细（请用 Excel/CSV 导入或粘贴解析）')
  if (!props.settleMode && !costCenters.value.length) missing.push('成本中心金额')
  if (missing.length) return `请先补齐：${missing.join('、')}`
  if (costCenters.value.some(c => !String(c.name || '').trim())) return '成本中心名称不能为空'
  if (!props.settleMode && costCenterMismatch.value) {
    return `成本中心金额合计 ¥${formatMoney(costCenterAmountTotal.value)} 必须等于单据总金额 ¥${formatMoney(totalAmount.value)}（差额 ¥${formatMoney(costCenterDiff.value)}）`
  }
  return ''
})

// 成本中心金额合计 / 差额（口径：金额优先，占比由金额自动算）
const costCenterAmountTotal = computed(() => Number(costCenters.value.reduce((sum, c) => sum + (Number(c.amount) || 0), 0).toFixed(10)))
const costCenterDiff = computed(() => Number((costCenterAmountTotal.value - totalAmount.value).toFixed(10)))
const costCenterMismatch = computed(() => costCenters.value.length > 0 && Math.abs(costCenterDiff.value) > 0.01)
const costCenterRatioTotal = computed(() => Number(costCenters.value.reduce((sum, c) => sum + Number(centerRatio(c)), 0).toFixed(2)))

function addCostCenter() { costCenters.value.push({ name: '', amount: 0 }) }
function removeCostCenter(i) { costCenters.value.splice(i, 1) }
function removeAttachment(storedName) { attachments.value = attachments.value.filter(a => a.storedName !== storedName) }

// 附件上传：只留存，不解析
async function onAttachChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('文件过大（超过 20MB）')
    event.target.value = ''
    return
  }
  attaching.value = true
  try {
    const buffer = await file.arrayBuffer()
    const { data } = await uploadAttachmentApi(toBase64(buffer), file.name)
    attachments.value.push(data)
    ElMessage.success(`附件已上传：${data.originalName}`)
  } catch { /* 错误提示由 request 统一处理 */ } finally {
    attaching.value = false
    event.target.value = ''
  }
}

// 占比由金额自动计算（后端同口径：最后一条吸收舍入，保证合计 100%）
function centerRatio(row) {
  const total = totalAmount.value
  if (!total) return 0
  return Number(((Number(row.amount) || 0) / total * 100).toFixed(2))
}
function addRow() {
  rows.value.push({ taskName: '', unit: '', quantity: 0, unitPrice: 0, amount: 0 })
}
function removeRow(index) { rows.value.splice(index, 1) }
function replaceRows(list) { rows.value = list.map(r => ({ ...r, amount: acceptanceRowAmount(r) })) }

watch(() => props.billId, async (id) => {
  if (!id || props.project) { editProjectId.value = props.project?.id || null; return }
  try {
    const { data } = await getBillDetailApi(id)
    editProjectId.value = data.projectId || null
  } catch { editProjectId.value = null }
}, { immediate: true })

// 打开时初始化：编辑模式拉取原单，新建模式清空
watch(() => props.modelValue, async (open) => {
  if (!open) return
  pasteText.value = ''
  importTab.value = 'excel'
  sourceFileName.value = ''
  importMode.value = 'manual'
  rows.value = []
  Object.assign(form, {
    batchName: '', period: '', remark: '', billNo: '',
    // 供应商身份以姓名口径：非PM 账号直接显示本账号姓名，PM 自行指定
    supplierName: isPm.value ? '' : (userStore.userInfo.userName || '')
  })
  costCenters.value = []
  attachments.value = []
  loadSuppliers()
  if (isEdit.value) await loadForEdit()
})

async function loadSuppliers() {
  if (!isPm.value) return
  // 甲方PM 代供应商建单时需要指定供应商（口径=姓名；供应商账号由后端强制取自身显示名）
  try {
    const { data } = await listSupplierNamesApi()
    supplierOptions.value = data || []
  } catch { /* 下拉为空时由后端校验 */ }
}

async function loadForEdit() {
  try {
    const { data } = await getBillDetailApi(props.billId)
    if (!data.permissions?.canEdit) {
      ElMessage.warning('该结算单当前不可修改')
      visible.value = false
      return
    }
    form.batchName = data.batchName
    form.period = data.period || ''
    form.remark = data.remark || ''
    form.supplierName = data.supplierName || ''
    form.billNo = data.billNo
    sourceFileName.value = data.sourceFileName || ''
    importMode.value = data.importMode || 'manual'
    costCenters.value = (data.costCenters || []).map(c => ({ name: c.name, amount: Number(c.amount) || 0 }))
    attachments.value = data.attachments || []
    replaceRows(data.items || [])
  } catch { visible.value = false }
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('文件过大（超过 10MB），请拆分后分批导入')
    event.target.value = ''
    return
  }
  parsing.value = true
  try {
    const buffer = await file.arrayBuffer()
    const base64 = toBase64(buffer)
    // 只解析成明细；原件留存请用上面的「上传附件」入口（两个入口互不干扰）
    const { data } = await parseAcceptanceFileApi(base64, file.name)
    replaceRows(data.items || [])
    sourceFileName.value = file.name
    importMode.value = 'excel'
    ElMessage.success(`解析成功，识别到 ${data.total} 条数据`)
    if (data.columns?.length) ElMessage.info('识别到的表头：' + data.columns.join(' / '))
  } catch { /* 错误提示由 request 统一处理 */ } finally {
    parsing.value = false
    event.target.value = ''
  }
}

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function onPasteParse() {
  if (!pasteText.value.trim()) { ElMessage.warning('请先粘贴内容'); return }
  const list = parseAcceptanceLines(pasteText.value)
  if (!list.length) { ElMessage.warning('未识别到有效数据行，请检查列顺序'); return }
  replaceRows(list)
  importMode.value = 'paste'
  sourceFileName.value = ''
  ElMessage.success(`解析成功，识别到 ${list.length} 条数据`)
}

function downloadTemplate() {
  const content = '\ufeff' + [ACCEPTANCE_COLUMNS.join(','), '1,烁雨7月标注数据-批次A,帧,1000,0.85,850'].join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = '验收数据导入模板.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

async function onSubmit() {
  const projectId = props.project?.id || editProjectId.value
  if (!projectId) { ElMessage.warning('缺少项目信息，请在项目管理页上传'); return }
  if (!form.batchName.trim()) { ElMessage.warning('请填写批次名称'); return }
  const invalid = rows.value.findIndex(r => !String(r.taskName || '').trim())
  if (rows.value.length && invalid >= 0) { ElMessage.warning(`第 ${invalid + 1} 行缺少项目`); return }
  if (!rows.value.length) { ElMessage.warning('请至少导入或添加一条验收数据'); return }
  if (!attachments.value.length) { ElMessage.warning('请先上传「附件（明细数据）」'); return }
  if (!props.settleMode && !costCenters.value.length) { ElMessage.warning('请填写成本中心金额（合计必须等于单据总金额）'); return }
  // 成本中心：名称齐全 + 金额合计等于单据总金额
  if (costCenters.value.length) {
    const emptyName = costCenters.value.find(c => !String(c.name || '').trim())
    if (emptyName) { ElMessage.warning('成本中心名称不能为空'); return }
    if (!props.settleMode && costCenterMismatch.value) {
      ElMessage.warning(`成本中心金额合计 ¥${formatMoney(costCenterAmountTotal.value)} 必须等于单据总金额 ¥${formatMoney(totalAmount.value)}（差额 ¥${formatMoney(costCenterDiff.value)}）`)
      return
    }
  }

  submitting.value = true
  const payload = {
    projectId,
    batchName: form.batchName.trim(),
    period: form.period || '',
    remark: form.remark,
    supplierName: form.supplierName,
    sourceFileName: sourceFileName.value,
    importMode: importMode.value,
    // 金额口径：占比由后端按金额推算（最后一条吸收舍入，合计正好 100%）
    costCenters: costCenters.value.map(c => ({ name: String(c.name).trim(), amount: Number(c.amount) || 0 })),
    attachments: attachments.value,
    items: rows.value.map(r => ({
      taskName: String(r.taskName).trim(),
      dataType: r.dataType,
      unit: r.unit,
      acceptDate: r.acceptDate,
      quantity: Number(r.quantity) || 0,
      unitPrice: Number(r.unitPrice) || 0,
      amount: Number(r.amount) || 0,
      dataPath: r.dataPath,
      remark: r.remark
    }))
  }
  try {
    if (props.settleMode) {
      // 统结方：把解析后的明细交给父组件提交（系统自动汇总金额）
      emit('settle-submit', {
        items: payload.items,
        costCenters: payload.costCenters,
        attachments: payload.attachments,
        remark: payload.remark
      })
      visible.value = false
      return
    }
    if (isEdit.value) {
      await updateBillApi(props.billId, payload)
      ElMessage.success('已保存修改')
    } else {
      const { data } = await createBillApi(payload)
      ElMessage.success(`已提交 ${data.billNo}，等待「业务工程师确认」`)
    }
    visible.value = false
    emit('submitted')
  } catch { /* ignore */ } finally { submitting.value = false }
}

function onClosed() {
  rows.value = []
  pasteText.value = ''
}
</script>

<style scoped>
.upload-dialog { max-height: 62vh; overflow-y: auto; padding-right: 4px; }
.subject {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; margin-bottom: 12px;
  background: var(--primary-bg, #edf2fe);
  border: 1px solid var(--primary-border, #ccd9f8);
  border-radius: 8px;
}
.subject-label { font-size: 12.5px; color: var(--text-3); }
.subject-name { font-size: 14px; font-weight: 700; color: var(--text-1); }
.mb14 { margin-bottom: 10px; }
.mb8 { margin-bottom: 8px; }
.import-box { display: flex; align-items: center; gap: 10px; padding: 4px 0 8px; flex-wrap: wrap; }
.import-box.col { flex-direction: column; align-items: stretch; gap: 10px; }
.hidden-file { display: none; }
.tip { font-size: 12.5px; color: var(--text-3); }
.sec-title { font-size: 14px; font-weight: 700; color: var(--text-1); margin: 6px 0 10px; }
.money { color: #67c23a; font-weight: 700; }
.totals { margin: 10px 0; font-size: 14px; color: var(--text-2); }
.center-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.center-total { font-size: 13px; color: var(--text-2); }
.center-total.bad { color: var(--danger, #d64550); font-weight: 600; }
.req { color: var(--danger, #d64550); }
.attach-box { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.block-tip { margin-right: 10px; font-size: 12.5px; color: var(--danger, #d64550); }
.totals b { color: var(--text-1); }
</style>
