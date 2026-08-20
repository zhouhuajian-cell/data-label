<template>
  <div>
    <el-tabs v-model="tab">
      <el-tab-pane label="用户审批" name="users">
        <div class="toolbar">
          <el-select v-model="userQuery.status" placeholder="状态" clearable style="width: 140px">
            <el-option label="待审批" value="PENDING" />
            <el-option label="已激活" value="ACTIVE" />
            <el-option label="已禁用" value="DISABLED" />
            <el-option label="已拒绝" value="REJECTED" />
          </el-select>
          <el-button type="primary" @click="loadUsers">查询</el-button>
        </div>
        <el-table :data="users" v-loading="userLoading" stripe>
          <el-table-column prop="name" label="姓名" width="120" />
          <el-table-column prop="username" label="账号" width="160" />
          <el-table-column label="飞书标识" width="160">
            <template #default="{ row }">{{ row.feishuOpenId || '-' }}</template>
          </el-table-column>
          <el-table-column label="角色" width="130">
            <template #default="{ row }">{{ row.roleType ? GND_ROLE_LABELS[row.roleType] : '未分配' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ACTIVE' ? 'success' : row.status === 'PENDING' ? 'warning' : 'info'" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="申请时间" width="170" />
          <el-table-column label="操作" width="220">
            <template #default="{ row }">
              <template v-if="row.status === 'PENDING'">
                <el-button link type="success" @click="openApprove(row)">审批通过</el-button>
                <el-button link type="danger" @click="reject(row)">拒绝</el-button>
              </template>
              <el-button v-else-if="row.status === 'ACTIVE'" link type="warning" @click="disable(row, 'DISABLED')">禁用</el-button>
              <el-button v-else-if="row.status === 'DISABLED'" link type="success" @click="disable(row, 'ACTIVE')">恢复</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="供应商名册" name="suppliers">
        <div class="toolbar">
          <el-input v-model="supQuery.keyword" placeholder="名称/编码" clearable style="width: 180px" @keyup.enter="loadSuppliers" />
          <el-button type="primary" @click="loadSuppliers">查询</el-button>
          <el-button type="success" @click="supVisible = true">新增供应商</el-button>
        </div>
        <el-table :data="suppliers" v-loading="supLoading" stripe>
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="name" label="名称" width="180" />
          <el-table-column prop="code" label="编码" width="120" />
          <el-table-column prop="contact" label="联系人" width="140" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="创建时间" width="170" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="approveVisible" title="审批通过" width="420px">
      <el-form label-width="90px">
        <el-form-item label="角色" required>
          <el-select v-model="approveForm.roleType" style="width: 100%">
            <el-option v-for="(label, v) in GND_ROLE_LABELS" :key="v" :label="label" :value="Number(v)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="approveForm.roleType === 12" label="供应商" required>
          <el-select v-model="approveForm.supplierId" style="width: 100%">
            <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveVisible = false">取消</el-button>
        <el-button type="primary" :loading="approving" @click="doApprove">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="supVisible" title="新增供应商" width="420px">
      <el-form label-width="90px">
        <el-form-item label="名称" required><el-input v-model="supForm.name" /></el-form-item>
        <el-form-item label="编码"><el-input v-model="supForm.code" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="supForm.contact" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="supVisible = false">取消</el-button>
        <el-button type="primary" @click="createSupplier">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { GND_ROLE_LABELS } from '@/utils/constants'
import { gndUsersApi, gndApproveUserApi, gndRejectUserApi, gndDisableUserApi, gndSuppliersApi, gndCreateSupplierApi } from '@/api/gnd'

const tab = ref('users')
const users = ref([])
const userLoading = ref(false)
const userQuery = reactive({ status: 'PENDING' })
const suppliers = ref([])
const supLoading = ref(false)
const supQuery = reactive({ keyword: '' })

const approveVisible = ref(false)
const approving = ref(false)
const approveForm = reactive({ userId: null, roleType: null, supplierId: null })
const supVisible = ref(false)
const supForm = reactive({ name: '', code: '', contact: '' })

const statusLabel = s => ({ PENDING: '待审批', ACTIVE: '已激活', DISABLED: '已禁用', REJECTED: '已拒绝' }[s] || s)

async function loadUsers() {
  userLoading.value = true
  try { users.value = (await gndUsersApi(userQuery)).data } catch { /* 已提示 */ } finally { userLoading.value = false }
}

async function loadSuppliers() {
  supLoading.value = true
  try { suppliers.value = (await gndSuppliersApi(supQuery)).data } catch { /* 已提示 */ } finally { supLoading.value = false }
}

function openApprove(row) { approveForm.userId = row.id; approveForm.roleType = null; approveForm.supplierId = null; approveVisible.value = true }
async function doApprove() {
  if (!approveForm.roleType) return ElMessage.warning('请选择角色')
  if (approveForm.roleType === 12 && !approveForm.supplierId) return ElMessage.warning('供应商角色必须指定供应商')
  approving.value = true
  try {
    await gndApproveUserApi(approveForm.userId, { roleType: approveForm.roleType, supplierId: approveForm.supplierId })
    ElMessage.success('已审批通过')
    approveVisible.value = false
    loadUsers()
  } catch { /* 已提示 */ } finally { approving.value = false }
}

async function reject(row) {
  try {
    await ElMessageBox.confirm('确认拒绝该注册申请？', '拒绝注册', { type: 'warning' })
    await gndRejectUserApi(row.id)
    ElMessage.success('已拒绝')
    loadUsers()
  } catch { /* 取消或已提示 */ }
}

async function disable(row, status) {
  await gndDisableUserApi(row.id, { status })
  ElMessage.success(status === 'DISABLED' ? '已禁用' : '已恢复')
  loadUsers()
}

async function createSupplier() {
  if (!supForm.name) return ElMessage.warning('请输入供应商名称')
  await gndCreateSupplierApi(supForm)
  ElMessage.success('已创建')
  supVisible.value = false
  loadSuppliers()
}

onMounted(() => { loadUsers(); loadSuppliers() })
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; margin-bottom: 14px; }
</style>
