<template>
  <div class="message-page">
    <el-card shadow="never">
      <template #header>
        <div class="msg-header">
          <el-radio-group v-model="msgType" size="small" @change="loadMsg">
            <el-radio-button value="all">全部消息</el-radio-button>
            <el-radio-button value="task">任务通知</el-radio-button>
            <el-radio-button value="qa">质检通知</el-radio-button>
            <el-radio-button value="system">系统通知</el-radio-button>
          </el-radio-group>
          <el-button text type="primary" @click="markAll">全部已读</el-button>
        </div>
      </template>

      <div class="msg-list" v-loading="loading">
        <div v-for="item in msgList" :key="item.id" class="msg-item" :class="{ unread: !item.read }" @click="readMsg(item)">
          <div class="msg-icon">
            <el-icon :size="20" :color="iconColor(item.type)">
              <Bell v-if="item.type === 'system'" />
              <Document v-else-if="item.type === 'task'" />
              <Warning v-else />
            </el-icon>
          </div>
          <div class="msg-content">
            <div class="msg-title">{{ item.title }}</div>
            <div class="msg-desc">{{ item.content }}</div>
            <div class="msg-time">{{ item.createdAt }}</div>
          </div>
          <div v-if="!item.read" class="unread-dot"></div>
        </div>
        <el-empty v-if="!msgList.length" description="暂无消息" :image-size="80" />
      </div>

      <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total"
        layout="prev, pager, next" @current-change="loadMsg" style="margin-top:16px;text-align:right" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Bell, Document, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fetchNotifications, markRead, markAllRead } from '@/api/notifications.js'
import { useUserStore } from '@/store/user.js'

const userStore = useUserStore()
const msgType = ref('all')
const page = ref(1)
const pageSize = 15
const total = ref(0)
const msgList = ref([])
const loading = ref(false)

const iconColor = (type) => ({ task: '#409eff', qa: '#f56c6c', system: '#909399' }[type] || '#909399')

async function loadMsg() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize, type: msgType.value === 'all' ? '' : msgType.value }
    const res = await fetchNotifications(params)
    msgList.value = res.data || []
    total.value = res.meta?.total || 0
    userStore.unReadMsg = res.meta?.unread || 0
  } catch { msgList.value = []; total.value = 0 }
  finally { loading.value = false }
}

async function readMsg(item) {
  if (!item.read) {
    try { await markRead(item.id); item.read = true; userStore.unReadMsg = Math.max(0, (userStore.unReadMsg || 1) - 1) } catch {}
  }
}

async function markAll() {
  try { await markAllRead(); msgList.value.forEach(i => i.read = true); userStore.unReadMsg = 0; ElMessage.success('全部已读') } catch {}
}

onMounted(loadMsg)
</script>

<style scoped>
.msg-header { display: flex; justify-content: space-between; align-items: center; }
.msg-item { display: flex; gap: 16px; padding: 16px; border-bottom: 1px solid #eee; cursor: pointer; position: relative; transition: background 0.2s; }
.msg-item:hover { background: #f5f7fa; }
.msg-item.unread { background: #ecf5ff; }
.msg-icon { width: 40px; height: 40px; border-radius: 50%; background: #f5f7fa; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.msg-content { flex: 1; }
.msg-title { font-size: 15px; font-weight: 500; margin-bottom: 6px; }
.msg-desc { color: #606266; font-size: 14px; margin-bottom: 6px; line-height: 1.5; }
.msg-time { color: #909399; font-size: 12px; }
.unread-dot { position: absolute; top: 20px; right: 20px; width: 8px; height: 8px; border-radius: 50%; background: #f56c6c; }
</style>
