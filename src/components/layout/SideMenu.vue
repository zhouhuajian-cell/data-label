<template>
  <div class="side-wrap" :class="{ fold: isFold }">
    <div class="logo-box">
      <span v-if="!isFold">Maxieye 数据协作平台</span>
      <DataLine v-else size="24" />
      <div class="fold-btn" @click="isFold = !isFold">
        <ArrowLeft />
      </div>
    </div>

    <el-menu
      :default-active="$route.path"
      collapse-transition
      :collapse="isFold"
      router
      class="menu-list"
      background-color="#001529"
      text-color="#fff"
      active-text-color="#409eff"
    >
      <el-menu-item index="/dashboard">
        <template #icon><DataBoard /></template>
        <template #title>仪表盘</template>
        <el-badge v-if="userStore.pendingTaskCount" :value="userStore.pendingTaskCount" />
      </el-menu-item>

      <el-menu-item v-if="isSupplierSide" index="/supplier/dashboard">
        <template #icon><HomeFilled /></template>
        <template #title>供应商门户</template>
        <el-badge v-if="userStore.unReadMsg" :value="userStore.unReadMsg" type="danger" />
      </el-menu-item>


      <el-menu-item v-if="isClientQa" index="/qa">
        <template #icon><Select /></template>
        <template #title>质检工作台</template>
      </el-menu-item>

      <el-menu-item v-if="canViewDataset" index="/dataset">
        <template #icon><Coin /></template>
        <template #title>数据管理中心</template>
      </el-menu-item>

      <el-menu-item v-if="canManageProjects" index="/supplier/projects">
        <template #icon><FolderOpened /></template>
        <template #title>项目管理</template>
      </el-menu-item>

      <el-menu-item v-if="isVendorTl" index="/task">
        <template #icon><Document /></template>
        <template #title>我的任务</template>
        <el-badge v-if="userStore.pendingTaskCount" :value="userStore.pendingTaskCount" />
      </el-menu-item>

      <el-menu-item v-if="userStore.token && canViewTaskManage" index="/task">
        <template #icon><Document /></template>
        <template #title>任务管理</template>
      </el-menu-item>

      <el-menu-item index="/message">
        <template #icon><Message /></template>
        <template #title>消息中心</template>
        <el-badge v-if="userStore.unReadMsg" :value="userStore.unReadMsg" type="danger" />
      </el-menu-item>

      <el-sub-menu v-if="isClientPm" index="admin-manage">
        <template #icon><OfficeBuilding /></template>
        <template #title>供应商管理</template>
        <el-menu-item index="/supplier/list">供应商列表</el-menu-item>
        <el-menu-item index="/finance/bill">结算管理</el-menu-item>
      </el-sub-menu>

      <el-menu-item v-if="isClientPm" index="/admin/users">
        <template #icon><User /></template>
        <template #title>用户管理</template>
      </el-menu-item>

      <el-menu-item v-if="isClientPm" index="/admin/logs">
        <template #icon><List /></template>
        <template #title>系统日志</template>
      </el-menu-item>

      <el-sub-menu v-if="isVendorTl" index="supplier-mine">
        <template #icon><User /></template>
        <template #title>我的管理</template>
        <el-menu-item index="/supplier/performance">绩效分析</el-menu-item>
        <el-menu-item index="/finance/bill">收款结算</el-menu-item>
      </el-sub-menu>

      <el-sub-menu v-if="userStore.isTaixingAdmin || userStore.isGnd" index="gnd-manage">
        <template #icon><Coin /></template>
        <template #title>GND 测区交付</template>
        <el-menu-item index="/gnd/tasks">测区任务</el-menu-item>
        <el-menu-item v-if="userStore.isTaixingAdmin" index="/gnd/users">用户审批</el-menu-item>
        <el-menu-item v-if="userStore.isTaixingAdmin" index="/gnd/dashboard">数据看板</el-menu-item>
      </el-sub-menu>
    </el-menu>

    <div class="user-footer">
      <el-dropdown trigger="click">
        <div class="user-info">
          <el-avatar size="30">{{ userStore.userInfo.userName.slice(0,1) }}</el-avatar>
          <span v-if="!isFold">{{ userStore.userInfo.userName }}</span>
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
  width: 220px;
  background: #001529;
  color: #fff;
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
}
.side-wrap.fold {
  width: 64px;
}
.logo-box {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 16px;
  font-weight: bold;
  border-bottom: 1px solid #1f2937;
  justify-content: space-between;
}
.fold-btn {
  cursor: pointer;
}
.menu-list {
  flex: 1;
  border-right: none;
}
.user-footer {
  height: 60px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  border-top: 1px solid #1f2937;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
</style>
