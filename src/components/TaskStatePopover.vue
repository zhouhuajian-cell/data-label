<template>
  <el-popover placement="top" :width="330" trigger="hover" :hide-after="120" @before-enter="load">
    <template #reference>
      <span class="state-ref" @click.stop>
        <el-tag :type="tagType" size="small">{{ stateText }}</el-tag>
      </span>
    </template>
    <div v-loading="loading" class="tl-pop">
      <div class="tl-title">{{ taskName }}</div>
      <el-timeline v-if="logs.length" class="tl-list">
        <el-timeline-item
          v-for="(l, i) in logs"
          :key="i"
          :timestamp="l.time"
          :type="l.type === 'danger' ? 'danger' : l.type === 'success' ? 'success' : 'primary'"
          :hollow="i !== 0"
        >
          <span class="tl-content">{{ l.content }}</span>
        </el-timeline-item>
      </el-timeline>
      <div v-else-if="!loading" class="tl-empty">暂无流转记录</div>
    </div>
  </el-popover>
</template>

<script setup>
import { ref } from 'vue'
import { getTaskDetailApi } from '@/api/tasks'

const props = defineProps({
  taskId: { type: [Number, String], required: true },
  state: { type: String, default: '' },
  taskName: { type: String, default: '' }
})

const loading = ref(false)
const logs = ref([])
const loaded = ref(false)

// 模块级缓存：同一任务不重复拉取
const cache = new Map()

async function load() {
  if (loaded.value) return
  if (cache.has(props.taskId)) { logs.value = cache.get(props.taskId); loaded.value = true; return }
  loading.value = true
  try {
    const { data } = await getTaskDetailApi(props.taskId)
    logs.value = data?.stateLog || []
    cache.set(props.taskId, logs.value)
    loaded.value = true
  } catch {}
  loading.value = false
}
</script>

<style scoped>
.state-ref { cursor: default; display: inline-flex; }
.tl-pop { min-height: 40px; }
.tl-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--divider);
}
.tl-list { padding-left: 2px; max-height: 260px; overflow-y: auto; }
.tl-content { font-size: 12.5px; color: var(--text-2); }
.tl-empty { text-align: center; color: var(--text-3); font-size: 13px; padding: 14px 0; }
</style>
