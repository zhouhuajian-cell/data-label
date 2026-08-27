<template>
  <div class="dl-wrap" v-if="percent !== null">
    <span class="dl-text" :class="colorClass">{{ text }}</span>
    <div class="dl-bar">
      <div class="dl-fill" :class="colorClass" :style="{ width: percent + '%' }" />
    </div>
  </div>
  <span v-else class="dl-text" style="color:var(--text-3)">-</span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  deadline: { type: String, default: '' },
  state: { type: String, default: '' },
  // 总周期假设（天）：用于计算已消耗比例
  spanDays: { type: Number, default: 14 }
})

const done = computed(() => ['ACCEPTED', 'ARCHIVED'].includes(props.state))

const remainDays = computed(() => {
  if (!props.deadline) return null
  const dl = new Date(String(props.deadline).replace(/-/g, '/')).getTime()
  if (isNaN(dl)) return null
  return (dl - Date.now()) / 86400000
})

const percent = computed(() => {
  if (remainDays.value === null) return null
  const used = 1 - Math.min(Math.max(remainDays.value, 0) / props.spanDays, 1)
  return Math.round(Math.min(Math.max(used * 100, 2), 100))
})

const colorClass = computed(() => {
  if (done.value) return 'is-done'
  if (remainDays.value === null) return ''
  if (remainDays.value < 0) return 'is-overdue'
  if (remainDays.value <= 2) return 'is-urgent'
  return 'is-safe'
})

const text = computed(() => {
  if (!props.deadline) return '-'
  if (done.value) return props.deadline
  const r = remainDays.value
  if (r === null) return props.deadline
  if (r < 0) return `已逾期 ${Math.abs(Math.ceil(r))} 天`
  if (r <= 2) return `剩 ${Math.ceil(r)} 天`
  return props.deadline
})
</script>

<style scoped>
.dl-wrap { display: flex; flex-direction: column; gap: 4px; }
.dl-text { font-size: 12.5px; color: var(--text-2); white-space: nowrap; }
.dl-bar {
  width: 90%;
  height: 4px;
  border-radius: 2px;
  background: var(--divider);
  overflow: hidden;
}
.dl-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
.is-safe { color: var(--text-2); }
.is-safe.dl-fill { background: linear-gradient(90deg, #67c23a, #95d475); }
.is-urgent { color: var(--warning); font-weight: 600; }
.is-urgent.dl-fill { background: linear-gradient(90deg, #e6a23c, #f3d19e); }
.is-overdue { color: var(--danger); font-weight: 600; }
.is-overdue.dl-fill { background: linear-gradient(90deg, #f56c6c, #fab6b6); }
.is-done { color: var(--text-3); }
</style>
