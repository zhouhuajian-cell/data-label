// 屏幕适配：笔记本（13~15 寸，常见 1280~1536 宽）下面板更紧凑
// 统一出口，避免各页面各写一套 resize 监听与断点
import { ref, computed, onMounted, onUnmounted } from 'vue'

// 断点（与 Element Plus 的 lg=1200 / xl=1920 保持错位，取页面实际可用宽度）
const NARROW = 1180   // 窄屏：抽屉全宽、表单单列、统计卡两列
const LAPTOP = 1500   // 笔记本：表单两列、统计卡两列/三列

export function useResponsive() {
  const width = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)

  let timer = null
  const onResize = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { width.value = window.innerWidth }, 120)
  }

  onMounted(() => window.addEventListener('resize', onResize))
  onUnmounted(() => {
    clearTimeout(timer)
    window.removeEventListener('resize', onResize)
  })

  const isNarrow = computed(() => width.value < NARROW)
  const isLaptop = computed(() => width.value < LAPTOP)

  // 统计卡列数：窄屏 2 列，笔记本 4 列，宽屏 4 列
  const statColumns = computed(() => (isNarrow.value ? 2 : 4))
  // 详情描述列数：窄屏 2 列（避免长标签换行），宽屏 3 列
  const descColumns = computed(() => (isLaptop.value ? 2 : 3))
  // 抽屉宽度：窄屏铺满，笔记本 78%，宽屏 62%
  const drawerSize = computed(() => (isNarrow.value ? '100%' : isLaptop.value ? '80%' : '62%'))
  // 表格列宽缩放系数：窄屏时压缩固定列宽，减少横向滚动
  const tableScale = computed(() => (isNarrow.value ? 0.82 : isLaptop.value ? 0.92 : 1))

  return { width, isNarrow, isLaptop, statColumns, descColumns, drawerSize, tableScale }
}
