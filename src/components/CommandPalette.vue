<template>
  <el-dialog
    v-model="visible"
    width="620px"
    :show-close="false"
    append-to-body
    class="cmd-dialog"
    @opened="focusInput"
    @closed="reset"
  >
    <div class="cmd-input-row">
      <el-icon class="cmd-search-icon"><Search /></el-icon>
      <input
        ref="inputRef"
        v-model="keyword"
        class="cmd-input"
        placeholder="搜索项目 / 任务（名称、ID、NanoID）"
        @input="onInput"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter="go"
        @keydown.esc="close"
      >
    </div>

    <div v-loading="loading" class="cmd-results">
      <template v-if="flat.length">
        <template v-for="g in groups" :key="g.label">
          <div class="cmd-group-title">{{ g.label }}</div>
          <div
            v-for="item in g.items"
            :key="g.key + item.id"
            class="cmd-item"
            :class="{ active: cursor === flat.indexOf(item) }"
            @mouseenter="cursor = flat.indexOf(item)"
            @click="go()"
          >
            <el-icon class="cmd-item-icon"><component :is="g.icon" /></el-icon>
            <div class="cmd-item-main">
              <div class="cmd-item-name">{{ item.name }}</div>
              <div class="cmd-item-meta">{{ item.meta }}</div>
            </div>
            <el-tag :type="item.tagType" size="small" effect="plain">{{ item.tag }}</el-tag>
          </div>
        </template>
      </template>
      <div v-else class="cmd-empty">
        {{ keyword.trim() ? '未找到匹配结果' : '输入关键词，快速跳转项目与任务' }}
      </div>
    </div>

    <div class="cmd-hints">
      <span><b>↑↓</b> 选择</span>
      <span><b>Enter</b> 打开</span>
      <span><b>Esc</b> 关闭</span>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, FolderOpened, Document } from '@element-plus/icons-vue'
import { request } from '@/api/client.js'
import { getTaskStateText } from '@/utils/constants'

const router = useRouter()
const visible = ref(false)
const keyword = ref('')
const loading = ref(false)
const inputRef = ref(null)
const cursor = ref(0)

const projects = ref([])
const tasks = ref([])

const filteredProjects = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return []
  return projects.value
    .filter(p => p.name.toLowerCase().includes(k))
    .slice(0, 5)
    .map(p => ({
      id: p.id, kind: 'project', name: p.name,
      meta: `${p.annotateType || '-'} · ${p.sampleCount || 0} 样本 · ${p.status === 'active' ? '进行中' : p.status === 'completed' ? '已完成' : p.status === 'paused' ? '已暂停' : '已归档'}`,
      tag: '项目', tagType: 'info', route: '/supplier/projects'
    }))
})

const filteredTasks = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return []
  return tasks.value
    .filter(t =>
      String(t.id).includes(k) ||
      (t.taskName || '').toLowerCase().includes(k) ||
      (t.nanoId || '').toLowerCase().includes(k))
    .slice(0, 8)
    .map(t => ({
      id: t.id, kind: 'task', name: t.taskName || ('任务 #' + t.id),
      meta: `ID:${t.id}${t.nanoId ? ' · ' + t.nanoId : ''} · ${t.supplierName || '未派发'}`,
      tag: getTaskStateText(t.state), tagType: t.state === 'ACCEPTED' ? 'success' : t.state === 'REJECTED' ? 'danger' : 'warning',
      route: '/task/detail/' + t.id
    }))
})

const groups = computed(() => {
  const g = []
  if (filteredProjects.value.length) g.push({ key: 'p', label: '项目', icon: FolderOpened, items: filteredProjects.value })
  if (filteredTasks.value.length) g.push({ key: 't', label: '任务', icon: Document, items: filteredTasks.value })
  return g
})

const flat = computed(() => groups.value.flatMap(g => g.items))

let debounceTimer = null
function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(search, 250)
  cursor.value = 0
}

async function search() {
  if (!keyword.value.trim()) { tasks.value = []; return }
  loading.value = true
  try {
    const res = await request('/tasks?pageSize=20&searchKey=' + encodeURIComponent(keyword.value.trim()))
    tasks.value = res.data || []
  } catch {}
  loading.value = false
}

function move(dir) {
  if (!flat.value.length) return
  cursor.value = (cursor.value + dir + flat.value.length) % flat.value.length
  scrollActiveIntoView()
}

function scrollActiveIntoView() {
  requestAnimationFrame(() => {
    const el = document.querySelector('.cmd-item.active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function go() {
  const item = flat.value[cursor.value]
  if (!item) return
  close()
  router.push(item.route)
}

function focusInput() { inputRef.value?.focus() }
function reset() { keyword.value = ''; tasks.value = []; cursor.value = 0 }
function close() { visible.value = false }
function open() {
  visible.value = true
  loadProjects()
}

async function loadProjects() {
  if (projects.value.length) return
  try {
    const res = await request('/projects')
    projects.value = res.data || []
  } catch {}
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    visible.value ? close() : open()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ open })
</script>

<style>
.cmd-dialog .el-dialog__header { display: none; }
.cmd-dialog .el-dialog__body { padding: 0; }
</style>

<style scoped>
.cmd-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.cmd-search-icon { font-size: 18px; color: var(--text-3); }
.cmd-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 16px;
  color: var(--text-1);
  background: transparent;
}
.cmd-input::placeholder { color: var(--text-3); }

.cmd-results {
  max-height: 380px;
  min-height: 120px;
  overflow-y: auto;
  padding: 8px;
}
.cmd-group-title {
  font-size: 12px;
  color: var(--text-3);
  padding: 8px 10px 4px;
  letter-spacing: 0.5px;
}
.cmd-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.cmd-item.active { background: var(--primary-bg); }
.cmd-item-icon { font-size: 17px; color: var(--primary); flex-shrink: 0; }
.cmd-item-main { flex: 1; min-width: 0; }
.cmd-item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-item-meta { font-size: 12px; color: var(--text-3); margin-top: 2px; }
.cmd-empty {
  text-align: center;
  color: var(--text-3);
  font-size: 13.5px;
  padding: 42px 0;
}
.cmd-hints {
  display: flex;
  gap: 16px;
  padding: 10px 18px;
  border-top: 1px solid var(--divider);
  font-size: 12px;
  color: var(--text-3);
}
.cmd-hints b {
  font-weight: 600;
  color: var(--text-2);
  background: var(--tag-bg);
  border-radius: 4px;
  padding: 1px 5px;
  margin-right: 3px;
}
</style>
