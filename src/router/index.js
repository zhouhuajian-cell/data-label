import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/store/user'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    redirect: '/dashboard',
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
      { path: '/supplier/list', name: 'SupplierList', component: () => import('@/views/supplier/list.vue'), meta: { title: '供应商列表', roles: [1] } },
      { path: '/supplier/projects', name: 'ProjectManage', component: () => import('@/views/supplier/projects.vue'), meta: { title: '项目管理', roles: [1, 7] } },
      { path: '/supplier/performance', name: 'Performance', component: () => import('@/views/supplier/performance.vue'), meta: { title: '绩效分析', roles: [3] } },
      { path: '/finance/bill', name: 'FinanceBill', component: () => import('@/views/finance/bill.vue'), meta: { title: '财务管理' } }
    ]
  },
  {
    path: '/gnd/login',
    redirect: '/login'
  },
  {
    path: '/gnd/pending',
    name: 'GndPending',
    component: () => import('@/views/gnd/Pending.vue'),
    meta: { title: '等待审批' }
  },
  {
    path: '/gnd',
    component: () => import('@/components/layout/MainLayout.vue'),
    children: [
      { path: '', redirect: '/gnd/tasks' },
      { path: 'tasks', name: 'GndTasks', component: () => import('@/views/gnd/Tasks.vue'), meta: { title: 'GND 任务', roles: [1, 8, 9, 10, 11, 12] } },
      { path: 'task/:id', name: 'GndTaskDetail', component: () => import('@/views/gnd/TaskDetail.vue'), meta: { title: 'GND 任务详情', roles: [1, 8, 9, 10, 11, 12] } },
      { path: 'users', name: 'GndUsers', component: () => import('@/views/gnd/Users.vue'), meta: { title: 'GND 用户审批', roles: [1, 8] } },
      { path: 'dashboard', name: 'GndDashboard', component: () => import('@/views/gnd/Dashboard.vue'), meta: { title: 'GND 看板', roles: [1, 8] } }
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
  if (to.path === '/login') {
    return userStore.token ? next('/dashboard') : next()
  }
  if (!userStore.token) {
    return next('/login')
  }
  if (userStore.isGndPending && to.path !== '/gnd/pending') {
    return next('/gnd/pending')
  }
  if (to.meta.roles && !to.meta.roles.includes(userStore.userInfo.roleType)) {
    return next(userStore.isGnd ? '/gnd/tasks' : '/dashboard')
  }
  next()
})

window.__router = router

export default router
