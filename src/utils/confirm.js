import { ElMessageBox } from 'element-plus'

// 危险操作确认（红色警告样式）
// 用于删除类不可恢复的操作：图标红、按钮红、按钮文案明确
// 动态内容（项目名/单号等）拼进 HTML 前先转义，避免注入
export function esc (v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function confirmDanger ({ title = '危险操作', message, confirmText = '确认删除', cancelText = '取消' }) {
  return ElMessageBox.confirm(message, title, {
    type: 'error',
    dangerouslyUseHTMLString: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    confirmButtonClass: 'el-button--danger',
    customClass: 'danger-confirm-box',
    closeOnClickModal: false
  })
}

// 二级确认：第一次提示影响范围，第二次再确认"不可恢复"
// 目的：防误删——第一次是"你要删什么"，第二次是"确定不可恢复"
export async function confirmDeleteTwice ({ title = '删除确认', first, second, firstText = '继续', secondText = '确认删除' }) {
  await confirmDanger({ title, message: first, confirmText: firstText })
  await confirmDanger({ title: '最终确认（不可恢复）', message: second, confirmText: secondText })
}
