<template>
  <div class="log-page">
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>系统操作日志</span>
          <span class="tip">仅保留最近 3 个月；更早的记录已按月归档到服务器 archive 目录（gzip，可随时查回）</span>
          <div style="display:flex;gap:8px">
            <el-select v-model="typeFilter" placeholder="操作类型" clearable size="small" style="width:160px" @change="load(1)">
              <el-option label="全部" value="" />
              <el-option label="验收结算" value="finance" />
              <el-option label="账号与登录" value="user" />
              <el-option label="项目" value="project" />
              <el-option label="任务" value="task" />
              <el-option label="结算" value="settlement" />
              <el-option label="导入" value="import" />
              <el-option label="治理" value="governance" />
              <el-option label="飞书" value="feishu" />
            </el-select>
            <el-button :icon="Refresh" size="small" @click="load(page)">刷新</el-button>
          </div>
        </div>
      </template>
      <el-table :data="list" border size="small" v-loading="loading" max-height="calc(100vh - 220px)">
        <el-table-column label="时间" prop="at" width="160" />
        <el-table-column label="操作人" width="120">
          <template #default="s"><b>{{ s.row.actorName || '系统' }}</b></template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="s">{{ actionLabel(s.row.action) }}</template>
        </el-table-column>
        <el-table-column label="对象" width="150" show-overflow-tooltip>
          <template #default="s">{{ targetText(s.row) }}</template>
        </el-table-column>
        <el-table-column label="详情" min-width="200">
          <template #default="s">{{ formatDetail(s.row) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination v-if="total > pageSize" style="margin-top:12px;text-align:right" :current-page="page" :page-size="pageSize" :total="total" layout="prev,pager,next" @current-change="load" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { getLogsApi } from '@/api/admin'
import { formatMoney } from '@/utils/constants'

const list = ref([])
const page = ref(1)
const pageSize = 30
const total = ref(0)
const typeFilter = ref('')
const loading = ref(false)

// 操作类型 → 中文（覆盖所有后端会写入的 action）
const ACTION_LABEL = {
  // 账号与登录
  'auth.login': '登录',
  'auth.loginFail': '登录失败',
  'auth.changePassword': '修改本人密码',
  'user.create': '新增账号',
  'user.update': '编辑账号',
  'user.disable': '停用账号',
  'user.resetPassword': '重置密码',
  // 验收结算确认流
  'finance.bill.create': '上传结算单',
  'finance.bill.update': '编辑结算单',
  'finance.bill.delete': '删除结算单',
  'finance.bill.assign': '指派工程师',
  'finance.bill.confirm': '确认通过',
  'finance.bill.reject': '驳回',
  'finance.bill.resubmit': '重新提交',
  'finance.bill.calculate': '财务核算',
  'finance.bill.urge': '加急催办',
  'finance.bill.compare': '统结对比',
  'finance.bill.compareBlock': '统结对比超限拦截',
  'finance.bill.settlement.resubmit': '统结方重新提交',
  'finance.settlement.totalCheck': '统结金额校验',
  // 项目
  'project.create': '创建项目',
  'project.update': '编辑项目',
  'project.updateStatus': '变更项目状态',
  'project.updateCount': '更新项目统计',
  'project.archive': '项目结项归档',
  'project.split': '拆分数据集',
  'project.import': '批量导入项目',
  'project.delete': '删除项目',
  'project.deleteBills': '级联删除结算单',
  // 任务与数据生产（数据生产域已关闭，保留映射备用）
  'task.create': '创建任务', 'task.dispatch': '派发任务', 'task.accept': '接单',
  'task.submit': '提交交付', 'task.reject': '驳回任务', 'task.pass': '任务验收通过',
  'task.update': '编辑任务', 'task.delete': '删除任务',
  'item.submit': '提交明细', 'item.vendorQa': '供应商质检', 'item.clientQa': '甲方质检',
  // 其他
  'settlement.generate': '生成结算单',
  'settlement.confirm': '确认结算',
  'governance.import': '导入数据集',
  'governance.statusChange': '变更数据状态',
  'governance.delete': '删除数据集',
  'scenarioDimension.save': '保存场景维度',
  'scenarioDimension.delete': '删除场景维度',
  'feishu.webhook': '配置飞书',
  'feishu.push': '推送飞书',
  'migration.passwordHash': '密码哈希迁移'
}

const actionLabel = (a) => ACTION_LABEL[a] || a || '-'

// 操作对象：优先取被操作的人/项目/单据
function targetText (row) {
  if (row.targetName) return row.targetName
  if (row.billNo && row.billNo !== '-') return row.billNo
  if (row.projectId) return '项目#' + row.projectId
  if (row.taskId) return '任务#' + row.taskId
  if (row.datasetId) return '数据集#' + row.datasetId
  if (row.username) return row.username
  return '-'
}

const ROLE_TEXT = { 1: '管理员', 2: '甲方质检员', 3: '供应商', 4: '标注员', 6: '算法工程师', 7: '数据清洗', 13: '业务工程师', 14: '财务', 15: '负责人', 16: '感知工程师', 17: '统一结算方', 18: 'OA结算专员', 19: '独立结算' }
const FIELD_TEXT = { userName: '姓名', username: '登录账号', disabled: '停用', roleTypes: '角色' }
const rolesText = (v) => (Array.isArray(v) ? v : [v]).filter(x => x !== null && x !== undefined).map(x => ROLE_TEXT[x] || x).join('、') || '无'
const valText = (field, v) => {
  if (field === 'roleTypes') return rolesText(v)
  if (field === 'disabled') return v ? '已停用' : '启用'
  return v === undefined || v === null || v === '' ? '空' : String(v)
}

// 详情：把各类操作的关键信息拼成一句话（金额统一 2 位）
function formatDetail (row) {
  const parts = []
  // 账号变更：列出改了哪些字段与前后值
  if (Array.isArray(row.changed) && row.changed.length) {
    const diffs = row.changed.map(k => `${FIELD_TEXT[k] || k}：${valText(k, row.before?.[k])} → ${valText(k, row.after?.[k])}`)
    parts.push(diffs.join('；'))
  }
  if (row.roleTypes && !Array.isArray(row.changed)) parts.push('角色：' + rolesText(row.roleTypes))
  if (row.stageLabel) parts.push(row.stageLabel)
  if (row.amount !== undefined) parts.push('金额 ¥' + formatMoney(row.amount))
  if (row.submittedTotal !== undefined) parts.push('统结金额 ¥' + formatMoney(row.submittedTotal))
  if (row.payableAmount !== undefined) parts.push('应付 ¥' + formatMoney(row.payableAmount))
  if (row.deduction) parts.push('扣款 ¥' + formatMoney(row.deduction))
  if (row.ratePercent !== undefined) parts.push('增幅 ' + row.ratePercent + '%')
  if (row.exceeded === true) parts.push('已超限')
  if (row.assigneeName) parts.push('指派给 ' + row.assigneeName)
  if (row.resubmitCount !== undefined) parts.push('第 ' + row.resubmitCount + ' 次重提')
  if (row.comment) parts.push('意见：' + row.comment)
  if (row.reason) parts.push('原因：' + row.reason)
  if (row.note) parts.push(row.note)
  if (row.deletedTasks !== undefined) parts.push('删除 ' + row.deletedTasks + ' 个任务')
  if (row.deletedBills !== undefined) parts.push('删除 ' + row.deletedBills + ' 张结算单')
  if (row.taskCount) parts.push(row.taskCount + ' 个任务')
  if (row.itemCount) parts.push(row.itemCount + ' 条明细')
  if (row.count) parts.push('共 ' + row.count + ' 项')
  if (row.status) parts.push('状态：' + row.status)
  if (row.method === 'feishu') parts.push('飞书登录')
  return parts.join(' · ') || '-'
}
async function load(p) {
  page.value = p || page.value
  loading.value = true
  try {
    const { data, meta } = await getLogsApi({ page: page.value, pageSize, type: typeFilter.value })
    list.value = data || []
    total.value = meta?.total || 0
  } finally { loading.value = false }
}

onMounted(() => load(1))
</script>

<style scoped>
.log-page{}.head{display:flex;justify-content:space-between;align-items:center}.tip{font-size:12px;color:var(--text-3,#909399)}
</style>
