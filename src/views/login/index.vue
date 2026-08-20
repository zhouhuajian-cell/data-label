<template>
  <div class="login-container">
    <div class="login-left">
      <h1>Maxieye 数据协作平台</h1>
      <div class="feature-item"><Promotion size="20" /><span>智能标注</span></div>
      <div class="feature-item"><Monitor size="20" /><span>质量管控</span></div>
      <div class="feature-item"><Lock size="20" /><span>数据安全</span></div>
      <div class="copyright">2026 Maxieye</div>
    </div>

    <div class="login-right">
      <div class="login-box">
        <h2>欢迎回来</h2>

        <div class="tab-row">
          <div class="tab-item" :class="{ active: loginMode === 'password' }" @click="loginMode = 'password'">账号登录</div>
          <div class="tab-item" :class="{ active: loginMode === 'feishu' }" @click="loginMode = 'feishu'">飞书登录</div>
        </div>

        <template v-if="loginMode === 'password'">
          <div class="demo-section">
            <div class="demo-label">演示账号</div>
            <div class="demo-list">
              <div
                v-for="item in demoAccounts"
                :key="item.username"
                class="demo-card"
                :class="{ active: loginForm.username === item.username }"
                @click="fillDemo(item)"
              >
                <div class="demo-role">{{ item.label }}</div>
                <div class="demo-account">{{ item.username }} / {{ item.password }}</div>
              </div>
            </div>
          </div>

          <el-form :model="loginForm" label-width="0" size="large">
            <el-form-item>
              <el-input v-model="loginForm.username" placeholder="账号" :prefix-icon="User" />
            </el-form-item>
            <el-form-item>
              <el-input v-model="loginForm.password" type="password" show-password placeholder="密码" @keyup.enter="handleLogin" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" class="login-btn" :loading="loading" @click="handleLogin">登 录</el-button>
            </el-form-item>
          </el-form>
        </template>

        <template v-if="loginMode === 'feishu'">
          <el-form :model="feishuForm" label-width="0" size="large">
            <el-form-item>
              <el-input v-model="feishuForm.username" placeholder="飞书手机号 / 邮箱" />
            </el-form-item>
            <el-form-item>
              <el-input v-model="feishuForm.password" type="password" show-password placeholder="飞书密码" @keyup.enter="handleFeishuLogin" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" class="login-btn" :loading="feishuLoading" @click="handleFeishuLogin">飞书登录</el-button>
            </el-form-item>
          </el-form>

          <div class="divider"><span>或</span></div>

          <el-form :model="qrForm" label-width="0" size="large">
            <el-form-item>
              <el-input v-model="qrForm.code" placeholder="飞书授权码" />
            </el-form-item>
            <el-form-item>
              <el-button class="login-btn" :loading="qrLoading" @click="handleCodeLogin">授权码登录</el-button>
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
        </template>

        <div class="gnd-entry">
          <el-button type="primary" plain size="large" class="gnd-entry-btn" @click="$router.push('/gnd/login')">进入 GND 量产数据交互平台 →</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Promotion, Monitor, Lock, User } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { loginApi, feishuLoginApi } from '@/api/auth'
import { gndLoginApi, gndFeishuApi } from '@/api/gnd'

const router = useRouter()
const userStore = useUserStore()

const loginMode = ref('password')
const loading = ref(false)
const feishuLoading = ref(false)
const qrLoading = ref(false)

const loginForm = reactive({ username: '', password: '' })
const feishuForm = reactive({ username: '', password: '' })
const qrForm = reactive({ code: '' })

const demoAccounts = [
  { label: '甲方PM', username: 'admin', password: '123' },
  { label: '甲方质检员', username: 'qa_01', password: '123' },
  { label: '供应商A_TL', username: 'supp_a', password: '123' },
  { label: '供应商B_TL', username: 'supp_b', password: '123' },
  { label: '算法工程师', username: 'algo_01', password: '123' },
  { label: '数据清洗A', username: 'clean_a1', password: '123' },
  { label: '数据清洗B', username: 'clean_b1', password: '123' },
  { label: 'GND 泰兴管理员', username: 'gnd_admin', password: 'gnd_admin_123' }
]

// 按角色决定登录后落地页
function homeByRole(roleType) {
  if (roleType === 4) return '/task'              // 标注员账号已停用标注工作台，落地任务列表
  if (roleType === 2) return '/qa'  // 甲方质检 → 质检工作台
  if (roleType === 3) return '/supplier/dashboard'    // 供应商TL → 供应商门户
  if (roleType === 6) return '/dataset'              // R&D → 数据集中心
  if (roleType === 7) return '/dataset'              // 数据清洗 → 数据集管理
  if (roleType >= 8 && roleType <= 12) return '/gnd/tasks'  // GND 域 → 测区任务
  return '/dashboard'                                    // 甲方PM/算法 → 仪表盘
}

const demoCodes = [
  { label: '甲方', code: 'feishu-admin' },
  { label: '质检', code: 'feishu-qa' },
  { label: '供应商A', code: 'feishu-suppa' },
  { label: '供应商B', code: 'feishu-suppb' }
]

const fillDemo = (item) => {
  loginForm.username = item.username
  loginForm.password = item.password
}

function gndUserInfo(info) {
  return { userName: info.name || info.username, roleType: info.roleType, supplierId: info.supplierId, domain: 'gnd', status: info.status }
}
function legacyUserInfo(info) {
  return { ...info, domain: 'legacy', status: 'ACTIVE' }
}
const handleLogin = async () => {
  if (!loginForm.username || !loginForm.password) {
    return ElMessage.warning('请输入账号和密码')
  }
  loading.value = true
  try {
    let data
    let isGnd = true
    try {
      const r = await gndLoginApi({ username: loginForm.username, password: loginForm.password })
      data = r.data
    } catch (e) {
      if (e.code === 'INVALID_CREDENTIALS') {
        // GND 无此账号 → 尝试旧平台账号
        const r = await loginApi({ username: loginForm.username, password: loginForm.password })
        data = r.data
        isGnd = false
      } else {
        throw e // GND_USER_PENDING / GND_USER_DISABLED 等直接提示
      }
    }
    userStore.setLogin({ token: data.token, userInfo: isGnd ? gndUserInfo(data.userInfo) : legacyUserInfo(data.userInfo) })
    router.push(isGnd ? '/gnd/tasks' : homeByRole(data.userInfo.roleType))
  } finally {
    loading.value = false
  }
}

const handleFeishuLogin = async () => {
  feishuLoading.value = true
  try {
    // 先尝试 GND 域飞书（含注册申请），再尝试旧域飞书
    let handled = false
    try {
      const r = await gndFeishuApi({ code: feishuForm.username, name: feishuForm.username })
      const d = r.data
      if (d.registered) {
        ElMessage.success(d.message || '注册申请已提交，等待管理员审批')
        handled = true
      } else {
        userStore.setLogin({ token: d.token, userInfo: gndUserInfo(d.userInfo) })
        router.push('/gnd/tasks')
        handled = true
      }
    } catch (e) {
      if (e.code !== 'GND_USER_PENDING' && e.code !== 'GND_USER_DISABLED' && e.code !== 'INVALID_CREDENTIALS') throw e
    }
    if (handled) return
    const { data } = await feishuLoginApi({ username: feishuForm.username, password: feishuForm.password })
    userStore.setLogin({ token: data.token, userInfo: legacyUserInfo(data.userInfo) })
    router.push(homeByRole(data.userInfo.roleType))
  } catch (e) {
    if (e.code !== 'INVALID_CREDENTIALS') ElMessage.warning('飞书登录失败，请使用账号密码登录')
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
</script>

<style scoped>
.login-container {
  display: flex;
  width: 100vw;
  height: 100vh;
}

.login-left {
  width: 45%;
  background: linear-gradient(135deg, #409eff, #2979eb);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 24px;
}
.login-left h1 {
  font-size: 30px;
  letter-spacing: 4px;
}
.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  opacity: 0.9;
}
.gnd-entry { margin-top: 18px; }
.gnd-entry-btn { width: 100%; }
.copyright {
  position: absolute;
  bottom: 40px;
  opacity: 0.6;
  font-size: 13px;
}

.login-right {
  width: 55%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.login-box {
  width: 400px;
}
.login-box h2 {
  font-size: 22px;
  margin-bottom: 24px;
  color: #303133;
}

.tab-row {
  display: flex;
  margin-bottom: 24px;
  border-bottom: 2px solid #ebeef5;
}
.tab-item {
  flex: 1;
  text-align: center;
  padding: 10px 0;
  cursor: pointer;
  color: #909399;
  font-size: 15px;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}
.tab-item.active {
  color: #409eff;
  border-bottom-color: #409eff;
  font-weight: 500;
}

.demo-section {
  margin-bottom: 20px;
}
.demo-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}
.demo-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.demo-card {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.demo-card:hover {
  border-color: #409eff;
}
.demo-card.active {
  border-color: #409eff;
  background: #ecf5ff;
}
.demo-role {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
}
.demo-account {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.login-btn {
  width: 100%;
}

.divider {
  display: flex;
  align-items: center;
  margin: 20px 0;
  color: #c0c4cc;
  font-size: 13px;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #ebeef5;
}
.divider span {
  padding: 0 16px;
}

.demo-code-list {
  margin-top: 16px;
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
</style>
