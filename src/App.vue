<template>
  <router-view />
</template>

<script setup>
// 根组件，路由自动渲染
</script>

<style>
:root {
  --color-primary: #409eff;
  --color-primary-dark: #337ecc;
  --color-primary-light: #ecf5ff;
  --color-danger: #f56c6c;
  --color-warning: #e6a23c;
  --color-success: #67c23a;
  --color-text-primary: #303133;
  --color-text-regular: #606266;
  --color-text-secondary: #909399;
  --color-border: #dcdfe6;
  --color-bg: #f5f7fa;
  --header-height: 60px;
  --sidebar-width: 220px;
  --sidebar-collapsed-width: 64px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
html, body, #app {
  width: 100%;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
html, body {
  background: var(--page-bg);
  color: var(--text-1);
}
</style>
