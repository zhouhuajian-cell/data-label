<template>
  <div class="layout-container">
    <SideMenu />
    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-left">
          <span class="page-title">{{ $route.meta.title || 'Maxieye 数据协同平台' }}</span>
        </div>
        <div class="topbar-right">
          <slot name="header-right" />
        </div>
      </header>
      <main class="page-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup>
import SideMenu from './SideMenu.vue'
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
.page-content {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
}
</style>
