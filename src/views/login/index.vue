<template>
  <div class="login-page">
    <div class="bg-glow glow-1" />
    <div class="bg-glow glow-2" />

    <div class="login-panel">
      <div class="brand-row">
        <div class="brand-mark"><span>M</span></div>
        <span class="brand-name">Maxieye 数据协同平台</span>
      </div>

      <div class="login-body">
        <div class="form-column">
          <h2 class="form-title">登录</h2>
          <p class="form-sub">请登录您的账号以继续</p>

          <el-tabs v-model="loginMode" class="mode-tabs">
            <el-tab-pane label="账号登录" name="password">
              <el-form :model="loginForm" label-width="0" @submit.prevent>
                <el-form-item>
                  <el-input v-model="loginForm.username" placeholder="账号" size="large" class="input-custom" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="loginForm.password" type="password" show-password placeholder="密码" size="large" class="input-custom" @keyup.enter="handleLogin" />
                </el-form-item>
                <el-form-item>
                  <el-button class="login-btn" :loading="loading" @click="handleLogin">登 录</el-button>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <el-tab-pane label="飞书登录" name="feishu">
              <el-form :model="feishuForm" label-width="0">
                <el-form-item>
                  <el-input v-model="feishuForm.username" placeholder="飞书手机号 / 邮箱" size="large" class="input-custom" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="feishuForm.password" type="password" show-password placeholder="飞书密码" size="large" class="input-custom" @keyup.enter="handleFeishuLogin" />
                </el-form-item>
                <el-form-item>
                  <el-button class="login-btn" :loading="feishuLoading" @click="handleFeishuLogin">飞书登录</el-button>
                </el-form-item>
              </el-form>

              <el-form :model="qrForm" label-width="0">
                <el-form-item>
                  <el-input v-model="qrForm.code" placeholder="飞书授权码" size="large" class="input-custom" @keyup.enter="handleCodeLogin" />
                </el-form-item>
                <el-form-item>
                  <el-button class="login-btn login-btn-ghost" :loading="qrLoading" @click="handleCodeLogin">授权码登录</el-button>
                </el-form-item>
              </el-form>

              <div class="demo-code-list">
                <span>演示授权码：</span>
                <el-button
                  v-for="item in demoCodes"
                  :key="item.code"
                  size="small"
                  text
                  type="primary"
                  @click="qrForm.code = item.code"
                >{{ item.label }}</el-button>
              </div>
            </el-tab-pane>
          </el-tabs>

          <div class="demo-select-wrap">
            <div class="demo-label">演示账号</div>
            <el-select
              v-model="selectedDemo"
              placeholder="选择演示账号"
              class="demo-select"
              @change="onDemoSelect"
            >
              <el-option
                v-for="item in demoAccounts"
                :key="item.username"
                :label="item.label + '（' + item.username + '）'"
                :value="item.username"
              />
            </el-select>
          </div>
        </div>
      </div>

      <div class="page-foot">© 2026 Maxieye · 智标数据协作平台</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import { loginApi, feishuLoginApi } from '@/api/auth'

const router = useRouter()
const userStore = useUserStore()

const loginMode = ref('password')
const loading = ref(false)
const feishuLoading = ref(false)
const qrLoading = ref(false)

const loginForm = reactive({ username: '', password: '' })
const feishuForm = reactive({ username: '', password: '' })
const qrForm = reactive({ code: '' })
const selectedDemo = ref('')

const ROLE_LABELS = { 1: '甲方PM', 2: '甲方质检', 3: '供应商TL', 4: '标注员', 6: '算法工程师', 7: '数据清洗' }

// 兜底列表（后端不可用时显示）
const demoAccounts = ref([
  { label: '泰兴基地', username: 'taixing', password: '123' },
  { label: '甲方质检', username: 'qa_01', password: '123' },
  { label: '供应商A', username: 'supp_a', password: '123' },
  { label: '供应商B', username: 'supp_b', password: '123' },
  { label: '算法工程师', username: 'algo_01', password: '123' },
  { label: '数据清洗A', username: 'clean_a1', password: '123' }
])

// 从后端实时拉取账号（后台改名/新增后自动同步）
async function loadDemoAccounts() {
  try {
    const res = await fetch('/api/auth/demo-accounts')
    const json = await res.json()
    if (json.code === 0 && Array.isArray(json.data) && json.data.length) {
      demoAccounts.value = json.data.map(u => ({
        label: `${u.userName}（${ROLE_LABELS[u.roleType] || '角色' + u.roleType}）`,
        username: u.username,
        password: '123'
      }))
    }
  } catch {}
}

const demoCodes = [
  { label: '甲方', code: 'feishu-admin' },
  { label: '质检', code: 'feishu-qa' },
  { label: '供应商A', code: 'feishu-suppa' },
  { label: '供应商B', code: 'feishu-suppb' }
]

// 按角色决定登录后落地页
function homeByRole(roleType) {
  if (roleType === 4) return '/task'
  if (roleType === 2) return '/qa'
  if (roleType === 3) return '/supplier/dashboard'
  if (roleType === 6) return '/dataset'
  if (roleType === 7) return '/dataset'
  return '/dashboard'
}

const fillDemo = (item) => {
  loginForm.username = item.username
  loginForm.password = item.password
}

const onDemoSelect = (username) => {
  const item = demoAccounts.value.find(a => a.username === username)
  if (item) fillDemo(item)
}

const handleLogin = async () => {
  if (!loginForm.username || !loginForm.password) {
    return ElMessage.warning('请输入账号和密码')
  }
  loading.value = true
  try {
    const { data } = await loginApi({ username: loginForm.username, password: loginForm.password })
    userStore.setLogin({ token: data.token, userInfo: data.userInfo })
    router.push(homeByRole(data.userInfo.roleType))
  } finally {
    loading.value = false
  }
}

const handleFeishuLogin = async () => {
  feishuLoading.value = true
  try {
    const { data } = await feishuLoginApi({ username: feishuForm.username, password: feishuForm.password })
    userStore.setLogin({ token: data.token, userInfo: data.userInfo })
    router.push(homeByRole(data.userInfo.roleType))
  } catch (e) {
    ElMessage.warning('飞书登录暂未对接，请使用账号密码登录')
  } finally {
    feishuLoading.value = false
  }
}

const handleCodeLogin = async () => {
  if (!qrForm.code) return ElMessage.warning('请输入飞书授权码')
  qrLoading.value = true
  try {
    const { data } = await feishuLoginApi({ code: qrForm.code })
    userStore.setToken(data.token)
    userStore.setUserInfo(data.userInfo)
    router.push(homeByRole(data.userInfo.roleType))
  } finally {
    qrLoading.value = false
  }
}

onMounted(loadDemoAccounts)
</script>

<style scoped>
.login-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  padding: 22px;
  box-sizing: border-box;
  display: flex;
  background:
    radial-gradient(1100px 560px at 8% -12%, rgba(61, 99, 221, 0.09), transparent 60%),
    radial-gradient(900px 520px at 100% 112%, rgba(124, 92, 240, 0.07), transparent 55%),
    var(--page-bg);
  overflow: hidden;
  font-family: var(--font-family);
}
.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.4;
  pointer-events: none;
}
.glow-1 { width: 640px; height: 640px; top: -240px; left: -160px; background: rgba(61, 99, 221, 0.13); }
.glow-2 { width: 560px; height: 560px; bottom: -240px; right: -160px; background: rgba(124, 92, 240, 0.1); }

/* ===== 铺满全屏的面板 ===== */
.login-panel {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(22px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 26px;
  box-shadow: 0 24px 80px rgba(23, 28, 38, 0.1), 0 2px 10px rgba(23, 28, 38, 0.04);
  padding: 34px 56px 22px;
  animation: panel-in 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  overflow: hidden;
}
@keyframes panel-in {
  from { opacity: 0; transform: translateY(14px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
.brand-mark {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  background: linear-gradient(135deg, #4f70ec 0%, #7c5cf0 100%);
  box-shadow: 0 4px 14px rgba(79, 112, 236, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.brand-mark span { font-size: 23px; font-weight: 800; color: #fff; }
.brand-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.4px;
}

/* 表单区域：水平居中、垂直居中，占满剩余空间 */
.login-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
.form-column {
  width: 100%;
  max-width: 540px;
  animation: form-in 0.5s 0.05s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
@keyframes form-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.form-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: -0.4px;
  margin: 0 0 6px;
  text-align: center;
}
.form-sub {
  font-size: 14.5px;
  color: var(--text-3);
  margin: 0 0 22px;
  text-align: center;
}

.mode-tabs :deep(.el-tabs__header) { margin: 0 0 24px; }
.mode-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background: var(--divider); }
.mode-tabs :deep(.el-tabs__item) {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-3);
  transition: color 0.2s;
  height: 48px;
}
.mode-tabs :deep(.el-tabs__item.is-active) { color: var(--primary); font-weight: 600; }
.mode-tabs :deep(.el-tabs__active-bar) { height: 3px; border-radius: 2px; }

.input-custom :deep(.el-input__wrapper) {
  border-radius: 12px;
  padding: 8px 18px;
  background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--border) inset;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}
.input-custom :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px var(--border-strong) inset; }
.input-custom :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px rgba(61, 99, 221, 0.5) inset;
  background: #fff;
}
.input-custom :deep(.el-input__inner) { font-size: 16px; color: var(--text-1); height: 40px; }

.login-btn {
  width: 100%;
  height: 52px;
  border-radius: 13px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 8px;
  border: none;
  background: linear-gradient(135deg, var(--primary) 0%, #6a5ae8 100%);
  color: #fff;
  box-shadow: 0 6px 18px rgba(61, 99, 221, 0.32);
  transition: all 0.2s ease;
  margin-top: 8px;
}
.login-btn:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(61, 99, 221, 0.4);
}
.login-btn:active { transform: translateY(0) scale(0.99); }
.login-btn-ghost {
  background: #fff;
  color: var(--primary);
  border: 1px solid var(--primary-border);
  box-shadow: none;
  letter-spacing: 3px;
}
.login-btn-ghost:hover { background: var(--primary-bg); }

.demo-code-list {
  margin-top: 6px;
  font-size: 14px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  justify-content: center;
}

.demo-select-wrap { margin-top: 28px; }
.demo-label { font-size: 13.5px; color: var(--text-3); margin-bottom: 9px; }
.demo-select { width: 100%; }
.demo-select :deep(.el-select__wrapper) {
  border-radius: 12px;
  background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--border) inset;
  min-height: 48px;
  font-size: 15px;
}

.page-foot {
  flex-shrink: 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  padding-top: 16px;
}
</style>
