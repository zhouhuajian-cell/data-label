<template>
  <div class="watermark-layer" :style="{ backgroundImage: `url(${watermarkUrl})` }"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useUserStore } from '@/store/user'

const props = defineProps({
  extra: { type: String, default: '' }
})

const userStore = useUserStore()
const watermarkUrl = ref('')
let timer = null

function buildWatermark() {
  const now = new Date()
  const time = now.toLocaleString('zh-CN', { hour12: false })
  const text = `${userStore.userInfo.userName}  ${time}${props.extra ? '  ' + props.extra : ''}`
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = '14px monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.translate(20, 90)
  ctx.rotate(-22 * Math.PI / 180)
  ctx.fillText(text, 0, 0)
  // 第二行加强
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.fillText('Maxieye 数据协作平台 · 禁止外传', 0, 22)
  watermarkUrl.value = canvas.toDataURL('image/png')
}

onMounted(() => {
  buildWatermark()
  timer = setInterval(buildWatermark, 1000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.watermark-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  background-repeat: repeat;
}
</style>
