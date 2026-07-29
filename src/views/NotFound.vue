<template>
  <div class="not-found">
    <div class="code">404</div>
    <div class="text">页面不存在</div>
    <el-button type="primary" @click="$router.push('/dashboard')">返回首页</el-button>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  gap: 16px;
}
.code {
  font-size: 72px;
  font-weight: bold;
  color: #c0c4cc;
}
.text {
  font-size: 18px;
  color: #909399;
}
</style>
