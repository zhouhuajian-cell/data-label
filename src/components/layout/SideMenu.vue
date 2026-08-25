<template>
  <div class="side-wrap" :class="{ fold: isFold }">
    <div class="logo-box">
      <div class="logo-mark" />
      <span v-if="!isFold" class="logo-title">Maxieye数据协同平台</span>
      <div class="fold-btn" @click="isFold = !isFold">
        <el-icon><ArrowLeft /></el-icon>
      </div>
    </div>

    <el-scrollbar class="menu-scroll">
      <el-menu
        :default-active="$route.path"
        collapse-transition
        :collapse="isFold"
        router
        class="menu-list"
        background-color="transparent"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataBoard /></el-icon>
          <template #title>仪表盘</template>
          <el-badge v-if="userStore.pendingTaskCount" :value="userStore.pendingTaskCount" />
        </el-menu-item>

        <el-menu-item v-if="isSupplierSide" index="/supplier/dashboard">
          <el-icon><HomeFilled /></el-icon>
          <template #title>供应商门户</template>
          <el-badge v-if="userStore.unReadMsg" :value="userStore.unReadMsg" type="danger" />
        </el-menu-item>

        <el-menu-item v-if="isClientQa" index="/qa">
          <el-icon><Select /></el-icon>
          <template #title>质检工作台</template>
        </el-menu-item>

        <el-menu-item v-if="canViewDataset" index="/dataset">
          <el-icon><Coin /></el-icon>
          <template #title>数据管理中心</template>
        </el-menu-item>

        <el-menu-item v-if="canManageProjects" index="/supplier/projects">
          <el-icon><FolderOpened /></el-icon>
          <template #title>项目管理</template>
        </el-menu-item>

        <el-menu-item v-if="isVendorTl" index="/task">
          <el-icon><Document /></el-icon>
          <template #title>我的任务</template>
          <el-badge v-if="userStore.pendingTaskCount" :value="userStore.pendingTaskCount" />
        </el-menu-item>

        <el-menu-item v-if="userStore.token && canViewTaskManage" index="/task">
          <el-icon><Document /></el-icon>
          <template #title>任务管理</template>
        </el-menu-item>

        <el-menu-item index="/message">
          <el-icon><Message /></el-icon>
          <template #title>消息中心</template>
          <el-badge v-if="userStore.unReadMsg" :value="userStore.unReadMsg" type="danger" />
        </el-menu-item>

        <el-sub-menu v-if="isClientPm" index="admin-manage">
          <template #title>
            <el-icon><OfficeBuilding /></el-icon>
            <span>供应商管理</span>
          </template>
          <el-menu-item index="/supplier/list">供应商列表</el-menu-item>
          <el-menu-item index="/finance/bill">结算管理</el-menu-item>
        </el-sub-menu>

        <el-menu-item v-if="isClientPm" index="/admin/users">
          <el-icon><User /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>

        <el-menu-item v-if="isClientPm" index="/admin/logs">
          <el-icon><List /></el-icon>
          <template #title>系统日志</template>
        </el-menu-item>

        <el-sub-menu v-if="isVendorTl" index="supplier-mine">
          <template #title>
            <el-icon><User /></el-icon>
            <span>我的管理</span>
          </template>
          <el-menu-item index="/supplier/performance">绩效分析</el-menu-item>
          <el-menu-item index="/finance/bill">收款结算</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-scrollbar>

    <div class="user-footer">
      <el-dropdown trigger="click">
        <div class="user-info">
          <el-avatar size="30" class="user-avatar">{{ userStore.userInfo.userName.slice(0,1) }}</el-avatar>
          <span v-if="!isFold" class="user-name">{{ userStore.userInfo.userName }}</span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="userStore.logout()">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useUserStore } from '@/store/user'
import { ROLE_TYPE } from '@/utils/constants'
import { DataLine, ArrowLeft, DataBoard, Document, FolderOpened, Message, OfficeBuilding, User, EditPen, Select, HomeFilled, Coin, List } from '@element-plus/icons-vue'
const userStore = useUserStore()
const isFold = ref(localStorage.getItem('sidebarFold') === '1')

const currentRole = computed(() => userStore.userInfo.roleType)
const isClientPm = computed(() => currentRole.value === ROLE_TYPE.CLIENT_PM)
const isClientQa = computed(() => currentRole.value === ROLE_TYPE.CLIENT_QA)
const isVendorTl = computed(() => currentRole.value === ROLE_TYPE.VENDOR_TL)
const isAnnotator = computed(() => currentRole.value === ROLE_TYPE.ANNOTATOR)
const isSupplierSide = computed(() => [ROLE_TYPE.VENDOR_TL, ROLE_TYPE.ANNOTATOR].includes(currentRole.value))
const canViewDataset = computed(() => [ROLE_TYPE.CLIENT_PM, ROLE_TYPE.ALGO_ENG, ROLE_TYPE.DATA_CLEANER].includes(currentRole.value))
const canManageProjects = computed(() => [ROLE_TYPE.CLIENT_PM, ROLE_TYPE.DATA_CLEANER].includes(currentRole.value))
const canViewTaskManage = computed(() => ![ROLE_TYPE.CLIENT_PM, ROLE_TYPE.CLIENT_QA, ROLE_TYPE.VENDOR_TL, ROLE_TYPE.ANNOTATOR].includes(currentRole.value))

watch(isFold, (val) => {
  localStorage.setItem('sidebarFold', val ? '1' : '0')
})
</script>

<style scoped>
.side-wrap {
  width: 232px;
  background: linear-gradient(180deg, var(--sidebar-bg-start) 0%, var(--sidebar-bg-end) 100%);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  position: relative;
}
.side-wrap::after {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02));
}
.side-wrap.fold { width: 68px; }

.logo-box {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 11px;
  border-bottom: 1px solid var(--sidebar-border);
  position: relative;
}
.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(135deg, #4f70ec, #7c5cf0);
  box-shadow: 0 4px 14px rgba(79, 112, 236, 0.45), inset 0 1px 0 rgba(255,255,255,0.25);
  flex-shrink: 0;
  position: relative;
}
.logo-mark::after {
  content: 'M';
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 800; color: #fff;
}
.logo-title {
  font-size: 14.5px;
  font-weight: 700;
  color: #f2f5fb;
  letter-spacing: 0.6px;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}
.fold-btn {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.2s, background 0.2s, box-shadow 0.2s;
  z-index: 5;
  box-shadow: var(--shadow-sm);
}
.fold-btn:hover { color: var(--primary); box-shadow: var(--shadow-md); }
.menu-scroll { flex: 1; min-height: 0; padding: 10px 10px; }
.menu-list {
  border-right: none;
  background: transparent;
}
.menu-list :deep(.el-menu-item),
.menu-list :deep(.el-sub-menu__title) {
  border-radius: 9px;
  margin: 3px 0;
  color: var(--sidebar-text);
  height: 42px;
  line-height: 42px;
  font-size: 14px;
  letter-spacing: 0.2px;
  transition: color 0.18s ease, background 0.18s ease;
  position: relative;
}
.menu-list :deep(.el-menu-item:hover),
.menu-list :deep(.el-sub-menu__title:hover) {
  background: var(--sidebar-hover-bg);
  color: #e8edf7;
}
.menu-list :deep(.el-menu-item.is-active) {
  background: var(--sidebar-active-bg);
  color: var(--sidebar-text-active);
  font-weight: 600;
}
.menu-list :deep(.el-menu-item.is-active)::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 3.5px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #6a8cf5, #4f70ec);
  box-shadow: 0 0 8px rgba(106, 140, 245, 0.7);
}
.menu-list :deep(.el-menu) { background: transparent; }
.menu-list :deep(.el-menu-item i),
.menu-list :deep(.el-sub-menu__title i) { color: inherit; }
/* 折叠时隐藏指示条避免溢出 */
.side-wrap.fold .menu-list :deep(.el-menu-item.is-active)::before { display: none; }

.user-footer {
  min-height: 62px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--sidebar-border);
  flex-shrink: 0;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  min-width: 0;
  width: 100%;
  padding: 6px 8px;
  border-radius: 9px;
  transition: background 0.18s ease;
}
.user-info:hover { background: var(--sidebar-hover-bg); }
.user-avatar {
  background: linear-gradient(135deg, #4f70ec, #7c5cf0);
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(79, 112, 236, 0.4);
}
.user-name {
  font-size: 13px;
  color: #cdd6e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
