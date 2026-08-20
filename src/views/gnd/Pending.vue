<template>
  <div class="pending">
    <el-result icon="info" title="注册申请已提交" sub-title="等待泰兴管理员审批，审批通过后即可使用平台">
      <template #extra>
        <el-button type="primary" @click="refresh">刷新状态</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
import { useUserStore } from '@/store/user'
import { gndMeApi } from '@/api/gnd'

const userStore = useUserStore()

async function refresh() {
  try {
    const { data } = await gndMeApi()
    userStore.setUserInfo(data)
    if (data.status === 'ACTIVE') {
      window.__router.push('/gnd/tasks')
    }
  } catch { /* 保持等待 */ }
}
</script>

<style scoped>
.pending { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
</style>
