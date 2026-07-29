<template>
  <div class="supplier-page">
    <el-card class="filter-card" shadow="never">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-input v-model="searchKey" placeholder="搜索供应商名称" clearable />
        </el-col>
        <el-col :span="4">
          <el-select v-model="levelFilter" placeholder="评级" clearable>
            <el-option label="S级" value="S" />
            <el-option label="A级" value="A" />
            <el-option label="B级" value="B" />
            <el-option label="C级" value="C" />
          </el-select>
        </el-col>
        <el-col :span="4">
          <el-button type="primary" @click="loadList">查询</el-button>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="table-header">
          <span>供应商列表</span>
        </div>
      </template>
      <el-table :data="supplierList" border>
        <el-table-column label="供应商ID" prop="id" width="100" />
        <el-table-column label="企业名称" prop="companyName" />
        <el-table-column label="评级" prop="level" width="100">
          <template #default="scope">
            <el-tag :type="getLevelType(scope.row.level)">{{ scope.row.level }}级</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="综合得分" prop="totalScore" width="120" />
        <el-table-column label="一次通过率" prop="passRate" width="120">
          <template #default="scope">{{ (scope.row.passRate * 100).toFixed(1) }}%</template>
        </el-table-column>
        <el-table-column label="准时交付率" prop="onTimeRate" width="120">
          <template #default="scope">{{ (scope.row.onTimeRate * 100).toFixed(1) }}%</template>
        </el-table-column>
        <el-table-column label="当前负载" prop="load" width="150">
          <template #default="scope">
            <el-progress :percentage="scope.row.load" :color="scope.row.load > 80 ? '#f56c6c' : '#67c23a'" />
          </template>
        </el-table-column>
        <el-table-column label="状态" prop="status" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.status === 1 ? 'success' : 'danger'">
              {{ scope.row.status === 1 ? '正常合作' : '暂停' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="scope">
            <el-button text type="primary" @click="$router.push(`/supplier/performance?id=${scope.row.id}`)">查看绩效</el-button>
            <el-button text type="warning">暂停派单</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
const searchKey = ref('')
const levelFilter = ref('')

const supplierList = ref([
  { id: 1, companyName: '上海智标科技有限公司', level: 'S', totalScore: 96.5, passRate: 0.98, onTimeRate: 0.99, load: 65, status: 1 },
  { id: 2, companyName: '北京数标智能', level: 'A', totalScore: 89.2, passRate: 0.92, onTimeRate: 0.95, load: 82, status: 1 },
  { id: 3, companyName: '深圳云标注', level: 'B', totalScore: 78.6, passRate: 0.85, onTimeRate: 0.88, load: 40, status: 1 },
  { id: 4, companyName: '广州标数科技', level: 'C', totalScore: 68.3, passRate: 0.72, onTimeRate: 0.75, load: 20, status: 0 }
])

const getLevelType = (level) => {
  return { S: 'danger', A: 'success', B: 'warning', C: 'info' }[level] || ''
}
const loadList = () => ElMessage.success('查询成功')
onMounted(() => {})
</script>

<style scoped>
.filter-card { margin-bottom: 16px; }
.table-header { display: flex; justify-content: space-between; align-items: center; }
</style>
