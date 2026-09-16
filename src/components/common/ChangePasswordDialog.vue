<template>
  <el-dialog
    v-model="visible"
    :title="forced ? '首次登录请修改密码' : '修改密码'"
    width="420px"
    :close-on-click-modal="false"
    :close-on-press-escape="!forced"
    :show-close="!forced"
    @closed="onClosed"
  >
    <el-alert v-if="forced" type="warning" :closable="false" show-icon class="mb12"
      title="当前为管理员分配的初始密码，为保障账号安全请先修改密码后再使用平台。" />

    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" label-position="top">
      <el-form-item label="原密码" prop="oldPassword">
        <el-input v-model="form.oldPassword" type="password" show-password placeholder="请输入当前密码" />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="form.newPassword" type="password" show-password placeholder="至少 6 位" />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirmPassword">
        <el-input v-model="form.confirmPassword" type="password" show-password placeholder="再次输入新密码" @keyup.enter="submit" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button v-if="!forced" @click="visible = false">取消</el-button>
      <el-button v-else type="info" plain @click="onLogout">退出登录</el-button>
      <el-button type="primary" :loading="loading" @click="submit">确认修改</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { changePasswordApi } from '@/api/auth'
import { useUserStore } from '@/store/user'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 首登强制改密：不可关闭，只能改密或退出登录
  forced: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'changed'])

const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const rules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '新密码至少 6 位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== form.newPassword) callback(new Error('两次输入的新密码不一致'))
        else callback()
      },
      trigger: 'blur'
    }
  ]
}

watch(() => props.modelValue, (open) => {
  if (open) {
    form.oldPassword = ''
    form.newPassword = ''
    form.confirmPassword = ''
  }
})

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    await changePasswordApi({ oldPassword: form.oldPassword, newPassword: form.newPassword })
    userStore.markPasswordChanged()
    ElMessage.success('密码已修改')
    visible.value = false
    emit('changed')
  } catch { /* 错误提示由 request 统一处理 */ } finally {
    loading.value = false
  }
}

function onClosed() {
  formRef.value?.clearValidate()
}

function onLogout() {
  visible.value = false
  userStore.logout()
}
</script>

<style scoped>
.mb12 { margin-bottom: 12px; }
</style>
