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

    <el-card v-if="userStore.isAdmin" shadow="hover" style="margin-top:16px">
      <template #header><span>飞书推送配置</span></template>
      <el-form label-width="80px" size="small">
        <el-form-item label="启用推送"><el-switch v-model="webhook.enabled" /></el-form-item>
        <div v-for="(w,i) in webhook.webhooks" :key="i" style="margin-bottom:8px">
          <el-form-item :label="'群'+(i+1)+'名称'"><el-input v-model="w.name" placeholder="如：项目通知群" style="width:140px" /></el-form-item>
          <el-form-item :label="'Webhook'"><el-input v-model="w.url" placeholder="飞书机器人Webhook地址" /><el-button text size="small" type="danger" @click="webhook.webhooks.splice(i,1)">删除</el-button></el-form-item>
        </div>
        <el-form-item><el-button size="small" text type="primary" @click="webhook.webhooks.push({name:'',url:''})">+ 添加群</el-button></el-form-item>
        <el-form-item label="测试推送">
          <el-select v-model="webhook.testIndex" placeholder="选择群" size="small" style="width:160px;margin-right:8px">
            <el-option v-for="(w,i) in webhook.webhooks" :key="i" :label="w.name||'群'+(i+1)" :value="i" />
          </el-select>
          <el-input v-model="webhook.testMsg" placeholder="测试消息" size="small" style="width:200px;margin-right:8px" />
          <el-button type="primary" size="small" @click="onTestPush">发送</el-button>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="onSaveWebhook">保存配置</el-button></el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
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

const webhook = reactive({ webhooks: [{ name: '默认通知群', url: '' }], enabled: true, testMsg: '', testIndex: 0 })

async function loadWebhook() {
  if (!userStore.isAdmin) return
  try {
    const token = localStorage.getItem('token') || ''
    const res = await fetch('/api/feishu/webhook', { headers: { Authorization: 'Bearer ' + token } })
    const json = await res.json()
    if (json.code === 0) { webhook.webhooks = json.data.webhooks || [{ name: '', url: '' }]; webhook.enabled = json.data.enabled }
  } catch {}
}

async function onSaveWebhook() {
  try {
    const token = localStorage.getItem('token') || ''
    await fetch('/api/feishu/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ webhooks: webhook.webhooks, enabled: webhook.enabled }) })
    ElMessage.success('飞书配置已保存')
  } catch { ElMessage.error('保存失败') }
}

async function onTestPush() {
  if (!webhook.testMsg) { ElMessage.warning('请输入测试消息'); return }
  try {
    const token = localStorage.getItem('token') || ''
    const res = await fetch('/api/feishu/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ title: '手动推送测试', content: webhook.testMsg, webhookIndex: webhook.testIndex }) })
    const json = await res.json()
    const data = json.data
    if (data?.results) {
      const msg = data.results.map(r => (r.ok ? '✓' : '✗') + r.resp).join(' | ')
      ElMessage({ message: msg, type: data.sent ? 'success' : 'warning', duration: 5000 })
    } else {
      ElMessage.warning(data?.reason || '推送失败')
    }
  } catch { ElMessage.error('推送失败') }
}

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

onMounted(() => { loadMsg(); loadWebhook() })
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
