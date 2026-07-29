<template>
  <div class="layout-container">
    <SideMenu />
    <div class="main-wrap">
      <header class="page-header">
        <span class="page-title">{{ $route.meta.title || 'Maxieye 数据协作平台' }}</span>
      </header>
      <div class="page-content">
        <router-view />
      </div>
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
}
.main-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-header {
  height: 60px;
  line-height: 60px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}
.page-title {
  font-size: 16px;
  font-weight: 500;
}
.page-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  background: #f5f7fa;
}
</style>
