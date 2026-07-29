<template>
  <div class="finance-page">
    <el-card shadow="hover">
      <el-row :gutter="20">
        <el-col :span="6"><div class="stat-item"><div class="stat-label">已结算金额</div><div class="stat-num" style="color:#67c23a">¥{{ fmt(stats.settled) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-item"><div class="stat-label">待结算金额</div><div class="stat-num" style="color:#e6a23c">¥{{ fmt(stats.pipeline) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-item"><div class="stat-label">预算总额</div><div class="stat-num">¥{{ fmt(stats.budget) }}</div></div></el-col>
        <el-col :span="6"><div class="stat-item"><div class="stat-label">预算使用率</div><div class="stat-num" :style="{color: stats.usageRate>80?'#f56c6c':'#409eff'}">{{ stats.usageRate }}%</div></div></el-col>
      </el-row>
    </el-card>

    <el-card style="margin-top:16px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>结算单管理</span>
          <el-button v-if="userStore.isAdmin" type="primary" :icon="Plus" @click="genVisible = true">生成结算单</el-button>
        </div>
      </template>
      <el-table :data="billList" border>
        <el-table-column label="结算单号" prop="billNo" width="190" />
        <el-table-column label="关联任务" prop="taskName" min-width="180" show-overflow-tooltip />
        <el-table-column label="供应商" prop="supplierName" width="110" />
        <el-table-column label="有效量" prop="validCount" width="80" />
        <el-table-column label="单价" width="80"><template #default="s">¥{{ s.row.unitPrice }}</template></el-table-column>
        <el-table-column label="一次通过率" width="110">
          <template #default="s"><span :style="{color: ffrColor(s.row.ffr)}">{{ (s.row.ffr*100).toFixed(1) }}%</span></template>
        </el-table-column>
        <el-table-column label="质量系数" width="100">
          <template #default="s">
            <el-tag :type="coefType(s.row.coef)" size="small">×{{ s.row.coef }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="基础金额" width="100"><template #default="s">¥{{ s.row.baseAmount }}</template></el-table-column>
        <el-table-column label="结算金额" width="110">
          <template #default="s"><span style="color:#67c23a;font-weight:bold">¥{{ s.row.amount }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="s">
            <el-tag :type="statusType(s.row)" size="small">{{ statusText(s.row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="s">
            <el-button v-if="canConfirm(s.row)" text type="primary" @click="onConfirm(s.row)">确认</el-button>
            <el-button text type="primary" @click="onExport(s.row)">导出CSV</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 阶梯系数说明（PRD 4.4） -->
    <el-card style="margin-top:16px" shadow="hover">
      <template #header>阶梯绩效结算规则</template>
      <el-descriptions :column="4" border>
        <el-descriptions-item label="FFR ≥ 98%">质量系数 ×1.2（奖励）</el-descriptions-item>
        <el-descriptions-item label="95% ≤ FFR < 98%">质量系数 ×1.0（正常）</el-descriptions-item>
        <el-descriptions-item label="90% ≤ FFR < 95%">质量系数 ×0.8（惩罚）</el-descriptions-item>
        <el-descriptions-item label="FFR < 90%">整包打回，不予结算</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-dialog v-model="genVisible" title="生成结算单" width="420px">
      <div style="margin-bottom:8px">系统将按任务的一次通过率(FFR)自动套用阶梯质量系数计算结算金额。</div>
      <el-form label-width="80px">
        <el-form-item label="任务">
          <el-select v-model="genForm.taskId" placeholder="选择已交付任务" style="width:100%">
            <el-option v-for="t in genTasks" :key="t.id" :label="t.taskName + '（' + t.supplierName + '）'" :value="t.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="genVisible = false">取消</el-button>
        <el-button type="primary" @click="onGenerate">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { request } from '@/api/client.js'
import { listSettlements, generateSettlement, confirmSettlement } from '@/api/settlement.js'

const userStore = useUserStore()
const billList = ref([])
const stats = reactive({ settled: 0, pipeline: 0, budget: 100000, usageRate: 0 })
const genVisible = ref(false)
const genForm = reactive({ taskId: null })
const genTasks = ref([])

const fmt = n => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function ffrColor(ffr) { return ffr >= 0.95 ? '#67c23a' : ffr >= 0.9 ? '#e6a23c' : '#f56c6c' }
function coefType(c) { return c >= 1.2 ? 'success' : c === 1.0 ? '' : c === 0.8 ? 'warning' : 'danger' }
function statusText(s) { return s.rejected ? '整包打回' : { PENDING: '待确认', CONFIRMING: '确认中', SETTLED: '已结算' }[s.status] || s.status }
function statusType(s) { return s.rejected ? 'danger' : { PENDING: 'warning', CONFIRMING: '', SETTLED: 'success' }[s.status] || 'info' }
function canConfirm(s) {
  if (s.rejected || s.status === 'SETTLED') return false
  if (userStore.isAdmin) return !s.confirms?.some(c => c.side === 'CLIENT')
  if (userStore.userInfo.roleType === 3) return s.supplierId === userStore.userInfo.supplierId && !s.confirms?.some(c => c.side === 'VENDOR')
  return false
}

async function loadData() {
  const res = await listSettlements()
  billList.value = res.data || []
  stats.settled = billList.value.filter(s => s.status === 'SETTLED').reduce((a, s) => a + s.amount, 0)
  stats.pipeline = billList.value.filter(s => !s.rejected && s.status !== 'SETTLED').reduce((a, s) => a + s.amount, 0)
  stats.usageRate = Number(((stats.settled + stats.pipeline) / stats.budget * 100).toFixed(1))
}

async function loadGenTasks() {
  if (!userStore.isAdmin) return
  const res = await request('/tasks?page=1&pageSize=100')
  genTasks.value = (res.data || []).filter(t => t.supplierId)
}

async function onGenerate() {
  if (!genForm.taskId) { ElMessage.warning('请选择任务'); return }
  try {
    await generateSettlement(genForm.taskId)
    ElMessage.success('结算单已生成')
    genVisible.value = false
    await loadData()
  } catch (e) {}
}

async function onConfirm(s) {
  try {
    await confirmSettlement(s.id)
    ElMessage.success('已确认')
    await loadData()
  } catch (e) {}
}

function onExport(s) {
  downloadCsv(s.id)
}

async function downloadCsv(id) {
  const token = localStorage.getItem('token') || ''
  const res = await fetch(`/api/settlements/${id}/export`, { headers: { Authorization: 'Bearer ' + token } })
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `结算单${id}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => { loadData(); loadGenTasks() })
</script>

<style scoped>
.stat-item { text-align: center; padding: 10px 0; }
.stat-label { color: #666; font-size: 14px; margin-bottom: 10px; }
.stat-num { font-size: 28px; font-weight: bold; color: #409eff; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
