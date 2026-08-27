<template>
  <div class="layout-container">
    <SideMenu />
    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-left">
          <span class="page-title">{{ $route.meta.title || 'Maxieye 数据协同平台' }}</span>
        </div>
        <div class="topbar-right">
          <div class="search-trigger" @click="paletteRef?.open()">
            <el-icon><Search /></el-icon>
            <span class="st-text">搜索项目 / 任务</span>
            <span class="st-kbd">Ctrl K</span>
          </div>
          <slot name="header-right" />
        </div>
      </header>
      <main class="page-content">
        <router-view />
      </main>
    </div>
    <CommandPalette ref="paletteRef" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import SideMenu from './SideMenu.vue'
import CommandPalette from '@/components/CommandPalette.vue'

const paletteRef = ref(null)
</script>

<style scoped>
.layout-container {
  display: flex;
  height: 100vh;
  background: var(--page-bg);
  color: var(--text-1);
}
.main-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.topbar {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(16px) saturate(1.4);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(23, 28, 38, 0.03);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
}
.page-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.3px;
  position: relative;
  padding-left: 14px;
}
.page-title::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--primary), #7c5cf0);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.search-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 9px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-3);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.18s ease;
  min-width: 200px;
}
.search-trigger:hover {
  border-color: var(--primary-border);
  color: var(--primary);
  background: var(--primary-bg);
}
.st-text { flex: 1; text-align: left; }
.st-kbd {
  font-size: 11px;
  color: var(--text-3);
  background: var(--tag-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  letter-spacing: 1px;
}
.page-content {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
}
</style>
