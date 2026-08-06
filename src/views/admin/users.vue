<template>
  <div class="user-page">
    <el-card shadow="never">
      <template #header>
        <div class="head"><span>用户管理（{{ list.length }} 人）</span><el-button type="primary" size="small" :icon="Plus" @click="openAdd">添加用户</el-button></div>
      </template>
      <el-table :data="list" border size="small">
        <el-table-column label="手机号/账号" prop="username" width="140" />
        <el-table-column label="姓名" prop="userName" width="120" />
        <el-table-column label="角色" width="120"><template #default="s">{{ ROLE_LABELS[s.row.roleType] }}</template></el-table-column>
        <el-table-column label="归属供应商" width="120"><template #default="s">{{ s.row.supplierId||'-' }}</template></el-table-column>
        <el-table-column label="状态" width="80"><template #default="s"><el-tag :type="s.row.disabled?'danger':'success'" size="small">{{ s.row.disabled?'已禁用':'正常' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="s">
            <el-button text size="small" type="primary" @click="openEdit(s.row)">编辑</el-button>
            <el-popconfirm title="确定禁用？" @confirm="onDelete(s.row)"><template #reference><el-button text size="small" type="danger">{{ s.row.disabled?'恢复':'禁用' }}</el-button></template></el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlgVisible" :title="editId?'编辑用户':'添加用户'" width="460px">
      <el-form label-width="90px" size="small">
        <el-form-item label="手机号/账号"><el-input v-model="form.username" placeholder="手机号作为登录账号" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.userName" placeholder="显示姓名" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="form.password" placeholder="留空不修改密码" /></el-form-item>
        <el-form-item label="角色"><el-select v-model="form.roleType" style="width:100%"><el-option v-for="(v,k) in ROLE_LABELS" :key="k" :label="v" :value="Number(k)" /></el-select></el-form-item>
        <el-form-item label="供应商" v-if="[3,4].includes(form.roleType)"><el-select v-model="form.supplierId" clearable style="width:100%"><el-option label="供应商A(101)" :value="101" /><el-option label="供应商B(102)" :value="102" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="dlgVisible=false">取消</el-button><el-button type="primary" @click="onSave">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { ROLE_LABELS } from '@/utils/constants.js'

const list = ref([])
const dlgVisible = ref(false)
const editId = ref(null)
const form = reactive({ username: '', userName: '', password: '', roleType: 4, supplierId: null })

async function loadList() {
  const t = localStorage.getItem('token') || ''
  try { const r = await fetch('/api/users', { headers: { Authorization: 'Bearer ' + t } }); list.value = (await r.json()).data || [] } catch {}
}

function openAdd() { editId.value = null; form.username = ''; form.userName = ''; form.password = ''; form.roleType = 4; form.supplierId = null; dlgVisible.value = true }
function openEdit(row) { editId.value = row.id; form.username = row.username; form.userName = row.userName; form.password = ''; form.roleType = row.roleType; form.supplierId = row.supplierId; dlgVisible.value = true }

async function onSave() {
  if (!form.username.trim()) { ElMessage.warning('请输入账号'); return }
  const t = localStorage.getItem('token') || ''
  const body = { ...form }; if (!body.password) delete body.password
  try {
    await fetch(editId.value ? '/api/users/' + editId.value : '/api/users', { method: editId.value ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body) })
    ElMessage.success(editId.value ? '已更新' : '已创建')
    dlgVisible.value = false; loadList()
  } catch { ElMessage.error('操作失败') }
}

async function onDelete(row) {
  const t = localStorage.getItem('token') || ''
  try { await fetch('/api/users/' + row.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); loadList(); ElMessage.success(row.disabled ? '已恢复' : '已禁用') } catch { ElMessage.error('操作失败') }
}

onMounted(loadList)
</script>

<style scoped>
.user-page{}.head{display:flex;justify-content:space-between;align-items:center}
</style>
