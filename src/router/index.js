import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/store/user'
import { BILL_ALL_ROLES, FEATURES, defaultHomePath, isHiddenByDataModule, hasAnyRole, canAccessBills, isSettlementParty } from '@/utils/constants'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    // 根路径按账号全部角色落到各自首页（结算相关角色 → 验收结算确认）
    redirect: () => {
      try {
        return defaultHomePath(JSON.parse(localStorage.getItem('userInfo') || '{}'))
      } catch {
        return '/dashboard'
      }
    },
    component: () => import('@/components/layout/MainLayout.vue'),
    children: [
      { path: '/dashboard', name: 'Dashboard', component: () => import('@/views/dashboard/index.vue'), meta: { title: '仪表盘' } },
      { path: '/qa', name: 'QaWorkbench', component: () => import('@/views/workbench/qa.vue'), meta: { title: '质检工作台', roles: [2, 3] } },
      { path: '/dataset', name: 'Dataset', component: () => import('@/views/dataset/index.vue'), meta: { title: '数据管理中心', roles: [1, 6, 7] } },
      { path: '/admin/users', name: 'AdminUsers', component: () => import('@/views/admin/users.vue'), meta: { title: '用户管理', roles: [1] } },
      { path: '/admin/logs', name: 'AdminLogs', component: () => import('@/views/admin/logs.vue'), meta: { title: '系统日志', roles: [1] } },
      { path: '/task', name: 'TaskList', component: () => import('@/views/task/list.vue'), meta: { title: '任务管理' } },
      { path: '/task/detail/:id', name: 'TaskDetail', component: () => import('@/views/task/detail.vue'), meta: { title: '任务详情' } },
      { path: '/message', name: 'Message', component: () => import('@/views/message/index.vue'), meta: { title: '消息中心' } },
      { path: '/supplier/dashboard', name: 'SupplierDashboard', component: () => import('@/views/supplier/dashboard.vue'), meta: { title: '供应商门户', roles: [3, 4] } },
      { path: '/supplier/list', name: 'SettlementSummary', component: () => import('@/views/supplier/list.vue'), meta: { title: '数据仪表盘', roles: [1, 14] } },
      { path: '/supplier/projects', name: 'ProjectManage', component: () => import('@/views/supplier/projects.vue'), meta: { title: '项目管理', roles: [1, 3, 7] } },
      { path: '/supplier/performance', name: 'Performance', component: () => import('@/views/supplier/performance.vue'), meta: { title: '绩效分析', roles: [3] } },
      // 数据验收进度：供应商上传已验收数据 → 工程师/财务/统结方/负责人/算法 逐环节确认
      { path: '/finance/bills', name: 'FinanceBills', component: () => import('@/views/finance/bills.vue'), meta: { title: '数据验收进度', roles: BILL_ALL_ROLES } },
      // 财务结算：逐单核算（财务/甲方PM）
      { path: '/finance/settlement', name: 'FinanceSettlement', component: () => import('@/views/finance/settlement.vue'), meta: { title: '财务结算', roles: [1, 14] } },
      // 旧版阶梯绩效结算（依赖标注明细，随数据生产模块一起隐藏）
      { path: '/finance/bill', name: 'FinanceBill', component: () => import('@/views/finance/bill.vue'), meta: { title: '财务管理' } }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  }
})

router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  const userInfo = userStore.userInfo
  if (to.path === '/login') {
    return userStore.token ? next(defaultHomePath(userInfo)) : next()
  }
  if (!userStore.token) {
    return next('/login')
  }
  // 数据生产模块关闭时，相关路由直接回落到本角色首页
  if (isHiddenByDataModule(to.path)) {
    return next(defaultHomePath(userInfo))
  }
  // 仪表盘已与「验收结算确认」整合为单页：数据生产域关闭时不再单独展示
  if (!FEATURES.DATA_MODULE && to.path === '/dashboard') {
    return next(defaultHomePath(userInfo))
  }
  // 结算确认页不对纯供应商开放（供应商在「项目管理」页内查看本项目结算单）
  if (to.path.startsWith('/finance/bills') && !canAccessBills(userInfo)) {
    return next(defaultHomePath(userInfo))
  }
  // 统结方不做项目维护：项目管理页对其隐藏（手动敲 URL 也回落到他的首页）
  if (to.path === '/supplier/projects' && isSettlementParty(userInfo)) {
    return next(defaultHomePath(userInfo))
  }
  // meta.roles 命中账号任一角色即放行（多角色）
  if (to.meta.roles && !hasAnyRole(userInfo, to.meta.roles)) {
    return next(defaultHomePath(userInfo))
  }
  next()
})

window.__router = router

export default router
