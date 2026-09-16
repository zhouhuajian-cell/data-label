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
          <p class="form-sub">请使用平台账号登录（账号由管理员分配）</p>

          <el-form :model="loginForm" label-width="0" @submit.prevent>
            <el-form-item>
              <el-input v-model="loginForm.username" placeholder="账号" size="large" class="input-custom" @keyup.enter="handleLogin" />
            </el-form-item>
            <el-form-item>
              <el-input v-model="loginForm.password" type="password" show-password placeholder="密码" size="large" class="input-custom" @keyup.enter="handleLogin" />
            </el-form-item>
            <el-form-item>
              <el-button class="login-btn" :loading="loading" @click="handleLogin">登 录</el-button>
            </el-form-item>
          </el-form>

          <div class="login-hint">
            忘记密码请联系项目管理员重置，重置后需在首次登录时修改。
          </div>
        </div>
      </div>

      <div class="page-foot">© 2026 Maxieye · 数据协作平台</div>
    </div>

    <!-- 管理员分配的初始密码：首次登录强制改密 -->
    <ChangePasswordDialog v-model="showChangePassword" forced @changed="enterPlatform" />
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import { loginApi } from '@/api/auth'
import { defaultHomePath } from '@/utils/constants'
import ChangePasswordDialog from '@/components/common/ChangePasswordDialog.vue'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const showChangePassword = ref(false)
const loginForm = reactive({ username: '', password: '' })

// 登录后落地页按账号全部角色计算（与路由守卫同一口径）
function enterPlatform() {
  router.push(defaultHomePath(userStore.userInfo))
}

const handleLogin = async () => {
  if (!loginForm.username || !loginForm.password) {
    return ElMessage.warning('请输入账号和密码')
  }
  loading.value = true
  try {
    const { data } = await loginApi({ username: loginForm.username, password: loginForm.password })
    userStore.setLogin({ token: data.token, userInfo: data.userInfo })
    // 管理员重置/新建的账号带 mustChangePassword 标记，先改密再进平台
    if (data.userInfo?.mustChangePassword) {
      showChangePassword.value = true
      return
    }
    enterPlatform()
  } finally {
    loading.value = false
  }
}
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

.login-panel {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(22px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 24px;
  box-shadow: 0 24px 80px rgba(23, 28, 38, 0.1), 0 2px 10px rgba(23, 28, 38, 0.04);
  padding: 30px 48px 20px;
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
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #4f70ec 0%, #7c5cf0 100%);
  box-shadow: 0 4px 14px rgba(79, 112, 236, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.brand-mark span { font-size: 22px; font-weight: 800; color: #fff; }
.brand-name {
  font-size: 19px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.4px;
}

.login-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
.form-column {
  width: 100%;
  max-width: 420px;
  animation: form-in 0.5s 0.05s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
@keyframes form-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.form-title {
  font-size: 30px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: -0.4px;
  margin: 0 0 6px;
  text-align: center;
}
.form-sub {
  font-size: 14px;
  color: var(--text-3);
  margin: 0 0 26px;
  text-align: center;
}

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
  height: 50px;
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

.login-hint {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--text-3);
  text-align: center;
  line-height: 1.7;
}

.page-foot {
  flex-shrink: 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  padding-top: 14px;
}

/* 笔记本（高度较矮）下压缩纵向留白，避免表单被顶出视口 */
@media (max-height: 780px) {
  .form-sub { margin-bottom: 18px; }
  .login-panel { padding: 24px 44px 16px; }
  .form-title { font-size: 27px; }
  .login-btn { height: 46px; }
}
</style>
