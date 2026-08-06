<template>
  <div class="log-page">
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>系统操作日志</span>
          <div style="display:flex;gap:8px">
            <el-select v-model="typeFilter" placeholder="操作类型" clearable size="small" style="width:160px" @change="load(1)">
              <el-option label="全部" value="" />
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
        <el-table-column label="时间" prop="at" width="170" />
        <el-table-column label="操作人" prop="actorName" width="110" />
        <el-table-column label="操作" prop="action" width="200" />
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

const list = ref([])
const page = ref(1)
const pageSize = 30
const total = ref(0)
const typeFilter = ref('')
const loading = ref(false)

const ACTION_LABEL = {
  'project.create': '创建项目', 'project.delete': '删除项目', 'project.update': '编辑项目',
  'project.updateStatus': '变更项目状态', 'project.archive': '项目结项归档', 'project.split': '拆分任务',
  'task.create': '创建任务', 'task.dispatch': '派发任务', 'task.accept': '接单',
  'task.submit': '提交交付', 'task.reject': '驳回任务', 'task.pass': '任务验收通过',
  'task.update': '编辑任务', 'task.delete': '删除任务',
  'item.submit': '提交明细', 'item.vendorQa': '供应商质检', 'item.clientQa': '甲方质检',
  'settlement.generate': '生成结算单', 'settlement.confirm': '确认结算',
  'governance.import': '导入数据', 'governance.statusChange': '变更数据状态', 'governance.delete': '删除数据集',
  'feishu.webhook': '配置飞书', 'project.import': '批量导入项目'
}

function formatDetail(row) {
  const parts = []
  if (row.projectId) parts.push('项目#' + row.projectId)
  if (row.taskId) parts.push('任务#' + row.taskId)
  if (row.supplierId) parts.push('供应商#' + row.supplierId)
  if (row.status) parts.push(row.status)
  if (row.deletedTasks !== undefined) parts.push('删除' + row.deletedTasks + '个任务')
  if (row.taskCount) parts.push(row.taskCount + '个任务')
  if (row.count) parts.push('共' + row.count + '条')
  if (row.datasetId) parts.push('数据集#' + row.datasetId)
  return parts.join(' · ') || row.action
}

async function load(p) {
  page.value = p || page.value
  loading.value = true
  try {
    const t = localStorage.getItem('token') || ''
    const params = `?page=${page.value}&pageSize=${pageSize}` + (typeFilter.value ? `&type=${typeFilter.value}` : '')
    const r = await fetch('/api/admin/logs' + params, { headers: { Authorization: 'Bearer ' + t } })
    const j = await r.json()
    list.value = j.data || []
    total.value = j.meta?.total || 0
  } finally { loading.value = false }
}

onMounted(() => load(1))
</script>

<style scoped>
.log-page{}.head{display:flex;justify-content:space-between;align-items:center}
</style>
