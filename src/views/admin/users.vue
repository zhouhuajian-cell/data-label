<template>
  <div class="user-page">
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>用户管理（{{ list.length }} 人）</span>
          <div>
            <el-input v-model="keyword" placeholder="搜索账号 / 姓名" clearable size="small" class="search" />
            <el-button type="primary" size="small" :icon="Plus" @click="openAdd">添加用户</el-button>
          </div>
        </div>
      </template>
      <el-table :data="filtered" border size="small">
        <el-table-column label="手机号/账号" prop="username" width="130" />
        <el-table-column label="姓名" prop="userName" width="110" show-overflow-tooltip />
        <el-table-column label="角色（可多角色）" min-width="220">
          <template #default="s">
            <el-tag v-for="r in s.row.roleTypes" :key="r" size="small" class="role-tag" :type="r === 3 ? 'warning' : 'info'">
              {{ ROLE_LABELS[r] || r }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="s">
            <el-tag :type="s.row.disabled ? 'danger' : 'success'" size="small">{{ s.row.disabled ? '已禁用' : '正常' }}</el-tag>
            <el-tag v-if="s.row.mustChangePassword" type="warning" size="small" class="role-tag">待改密</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="s">
            <el-button text size="small" type="primary" @click="openEdit(s.row)">编辑</el-button>
            <el-popconfirm title="重置为默认密码 123456？该账号下次登录需改密" @confirm="onReset(s.row)">
              <template #reference><el-button text size="small" type="warning">重置密码</el-button></template>
            </el-popconfirm>
            <el-popconfirm title="确定禁用/恢复该账号？" @confirm="onDelete(s.row)">
              <template #reference><el-button text size="small" type="danger">{{ s.row.disabled ? '恢复' : '禁用' }}</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!filtered.length" :image-size="70" :description="list.length ? '无匹配账号' : '暂无账号，请点击右上角添加'" />
    </el-card>

    <el-dialog v-model="dlgVisible" :title="editId ? '编辑用户' : '添加用户'" width="500px">
      <el-form label-width="90px" size="small" label-position="top">
        <el-form-item label="账号（手机号）" required>
          <el-input v-model="form.username" placeholder="手机号/拼音作为登录账号" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.userName" placeholder="显示姓名" />
        </el-form-item>
        <el-form-item :label="editId ? '重置密码（留空不改）' : '初始密码'">
          <el-input v-model="form.password" type="password" show-password :placeholder="editId ? '留空则不修改' : '留空默认 123456，首次登录需改密'" />
        </el-form-item>
        <el-form-item label="角色（可多选，环环相扣）" required>
          <el-checkbox-group v-model="form.roleTypes">
            <el-checkbox v-for="opt in roleOptions" :key="opt.value" :value="opt.value" :label="opt.value">{{ opt.label }}</el-checkbox>
          </el-checkbox-group>
          <div class="tip">多角色账号在确认链上可依次操作多个节点（例如同持业务工程师与财务）。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { ROLE_LABELS, ROLE_TYPE } from '@/utils/constants.js'
import { listUsersApi, createUserApi, updateUserApi, deleteUserApi, resetUserPasswordApi } from '@/api/admin'

const list = ref([])
const keyword = ref('')
const dlgVisible = ref(false)
const editId = ref(null)
const saving = ref(false)
const form = reactive({ username: '', userName: '', password: '', roleTypes: [] })

const DEFAULT_PASSWORD = '123456'

// 可分配角色（数据生产域角色随 FEATURES.DATA_MODULE 一并保留，不在界面暴露无效项）
const roleOptions = [
  { value: ROLE_TYPE.CLIENT_PM, label: '甲方PM' },
  { value: ROLE_TYPE.VENDOR_TL, label: '供应商团队长' },
  { value: ROLE_TYPE.BIZ_ENGINEER, label: '业务工程师' },
  { value: ROLE_TYPE.FINANCE, label: '财务' },
  { value: ROLE_TYPE.LEADER, label: '负责人' },
  { value: ROLE_TYPE.PERCEPTION, label: '感知工程师' },
  { value: ROLE_TYPE.SETTLEMENT, label: '统一结算方' },
  { value: ROLE_TYPE.OA_SETTLEMENT, label: 'OA结算专员' },
  { value: ROLE_TYPE.CLIENT_QA, label: '甲方质检员' },
  { value: ROLE_TYPE.ANNOTATOR, label: '标注员' },
  { value: ROLE_TYPE.ALGO_ENG, label: '算法工程师' },
  { value: ROLE_TYPE.DATA_CLEANER, label: '数据清洗人员' }
]

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return list.value
  return list.value.filter(u => u.username.toLowerCase().includes(k) || (u.userName || '').toLowerCase().includes(k))
})

async function loadList() {
  try { const { data } = await listUsersApi(); list.value = data || [] } catch { /* 提示由 request 统一处理 */ }
}

function openAdd() {
  editId.value = null
  Object.assign(form, { username: '', userName: '', password: '', roleTypes: [] })
  dlgVisible.value = true
}

function openEdit(row) {
  editId.value = row.id
  Object.assign(form, {
    username: row.username,
    userName: row.userName,
    password: '',
    roleTypes: [...(row.roleTypes || [row.roleType])]
  })
  dlgVisible.value = true
}

async function onSave() {
  if (!form.username.trim()) { ElMessage.warning('请输入账号'); return }
  if (!form.userName.trim()) { ElMessage.warning('请输入姓名'); return }
  if (!form.roleTypes.length) { ElMessage.warning('请至少选择一个角色'); return }
  saving.value = true
  const body = {
    username: form.username.trim(),
    userName: form.userName.trim(),
    roleTypes: form.roleTypes
  }
  if (form.password) body.password = form.password
  else if (!editId.value) body.password = DEFAULT_PASSWORD
  try {
    if (editId.value) await updateUserApi(editId.value, body)
    else await createUserApi({ username: form.username.trim(), ...body })
    ElMessage.success(editId.value ? '已更新' : `已创建（初始密码 ${DEFAULT_PASSWORD}，首次登录需改密）`)
    dlgVisible.value = false
    loadList()
  } catch { /* 提示由 request 统一处理 */ } finally { saving.value = false }
}

async function onReset(row) {
  try {
    await resetUserPasswordApi(row.id, DEFAULT_PASSWORD)
    ElMessage.success('已重置为 ' + DEFAULT_PASSWORD + '，该账号下次登录需改密')
    loadList()
  } catch { /* ignore */ }
}

async function onDelete(row) {
  try {
    await deleteUserApi(row.id)
    loadList()
    ElMessage.success(row.disabled ? '已恢复' : '已禁用')
  } catch { /* ignore */ }
}

onMounted(() => { loadList() })
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.search { width: 180px; margin-right: 8px; }
.role-tag { margin: 0 4px 3px 0; }
.tip { font-size: 12px; color: var(--text-3); line-height: 1.6; margin-top: 2px; }
</style>
