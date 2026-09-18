<template>
  <div class="chain" :class="{ compact, labelled }">
    <template v-for="(st, i) in chain" :key="st.key">
      <span v-if="i > 0" class="chain-line" :class="lineClass(i)" />
      <el-tooltip :content="tooltip(st)" placement="top" :show-after="120">
        <span class="chain-node" :class="nodeClass(st)">
          <el-icon v-if="st.done" class="chain-icon"><Check /></el-icon>
          <el-icon v-else-if="st.error" class="chain-icon"><Close /></el-icon>
          <span v-else class="chain-index">{{ i + 1 }}</span>
        </span>
      </el-tooltip>
    </template>
    <span v-if="labelled" class="chain-count" :class="tagClass">{{ doneCount }}/{{ chain.length }}</span>
    <span v-else-if="!compact" class="chain-text">{{ summaryText }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Check, Close } from '@element-plus/icons-vue'

const props = defineProps({
  // [{ key, label, short, done, active, error }]
  chain: { type: Array, default: () => [] },
  status: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  // 圆点后追加一枚短标签：列表里不悬停也能看懂卡在哪一环
  labelled: { type: Boolean, default: false }
})

const approved = computed(() => props.status === 'APPROVED')
const rejected = computed(() => props.status === 'REJECTED')

function nodeClass(st) {
  if (st.error) return 'is-error'
  if (st.done) return 'is-done'
  if (st.active) return 'is-active'
  return 'is-wait'
}

function lineClass(i) {
  const prev = props.chain[i - 1]
  const cur = props.chain[i]
  if (cur?.error || prev?.error) return 'is-error'
  if (prev?.done) return 'is-done'
  return 'is-wait'
}

function tooltip(st) {
  if (st.error) return `${st.label}：被驳回`
  if (st.done) return `${st.label}：已确认`
  if (st.active) return `${st.label}：待确认`
  return `${st.label}：未开始`
}

// 已完成节点数（列表里以 n/总数 呈现，具体卡在哪一环由「当前环节」列说明）
const doneCount = computed(() => props.chain.filter(s => s.done).length)

const tagClass = computed(() => {
  if (approved.value) return 'is-ok'
  if (rejected.value) return 'is-bad'
  return 'is-doing'
})

// 一句话总结当前进度：已确认 n/4，或卡在哪个节点
const summaryText = computed(() => {
  const total = props.chain.length
  const done = props.chain.filter(s => s.done).length
  if (approved.value) return `四级确认已全部通过（${total}/${total}）`
  if (rejected.value) {
    const err = props.chain.find(s => s.error)
    return `已被「${err ? err.short || err.label : '某节点'}」驳回（已确认 ${done}/${total}）`
  }
  const active = props.chain.find(s => s.active)
  return active ? `等待「${active.short || active.label}」确认（已确认 ${done}/${total}）` : `已确认 ${done}/${total}`
})
</script>

<style scoped>
.chain { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; justify-content: center; }
.chain-node {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  border: 1.5px solid transparent;
  transition: all 0.2s ease;
}
.chain-icon { font-size: 11px; }
.chain-index { line-height: 1; }
.chain-node.is-done { background: var(--success, #18a058); border-color: var(--success, #18a058); color: #fff; }
.chain-node.is-active { background: #fff; border-color: var(--primary, #3d63dd); color: var(--primary, #3d63dd); box-shadow: 0 0 0 3px rgba(61, 99, 221, 0.14); }
.chain-node.is-error { background: var(--danger, #d64550); border-color: var(--danger, #d64550); color: #fff; }
.chain-node.is-wait { background: var(--surface-2, #f8fafc); border-color: var(--border-strong, #d4dae4); color: var(--text-3, #8a93a3); }
.chain-line { width: 12px; height: 2px; border-radius: 1px; background: var(--border-strong, #d4dae4); flex-shrink: 0; }
.chain-line.is-done { background: var(--success, #18a058); }
.chain-line.is-error { background: var(--danger, #d64550); }
.chain-text { margin-left: 8px; font-size: 12px; color: var(--text-3, #8a93a3); white-space: nowrap; }
.chain.compact .chain-node { width: 14px; height: 14px; font-size: 9px; }
.chain.compact .chain-line { width: 8px; }
.chain.compact .chain-icon { font-size: 9px; }
/* 带标签模式：圆点更小 + 右侧短标签，整列更窄且不靠悬停
   尺寸与 .compact 同优先级，故写在后面覆盖上面两条 compact 规则 */
.chain.labelled { gap: 1px; }
.chain.labelled .chain-node { width: 13px; height: 13px; font-size: 8px; }
.chain.labelled .chain-line { width: 5px; }
.chain.labelled .chain-icon { font-size: 8px; }
.chain-count {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 9px;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.chain-count.is-ok { background: rgba(24, 160, 88, 0.12); color: var(--success, #18a058); }
.chain-count.is-bad { background: rgba(214, 69, 80, 0.12); color: var(--danger, #d64550); }
.chain-count.is-doing { background: rgba(61, 99, 221, 0.12); color: var(--primary, #3d63dd); }
</style>
