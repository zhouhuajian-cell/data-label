// 路由分发器：聚合各业务路由模块
//  - authRouter 无需鉴权（登录/健康检查）
//  - 其余模块在鉴权后按 项目 → 任务 → 工作台 → 治理 → 管理 顺序尝试匹配
import { ApiError } from '../lib/http.js'
import { authRouter } from './auth.js'
import { projectRouter } from './project.js'
import { taskRouter } from './task.js'
import { workbenchRouter } from './workbench.js'
import { governanceRouter } from './governance.js'
import { adminRouter } from './admin.js'
import { gndRouter } from './gnd.js'

export function createApiDispatcher(requireAuth) {
  return async function dispatch(req, res, url, pathname) {
    if (await authRouter({ req, res, url, pathname })) return true
    if (pathname.startsWith('/api/gnd')) {
      if (await gndRouter({ req, res, url, pathname })) return true
      throw new ApiError(404, 'NOT_FOUND', '接口不存在')
    }
    const user = requireAuth(req)
    const ctx = { req, res, url, pathname, user }
    if (await projectRouter(ctx)) return true
    if (await taskRouter(ctx)) return true
    if (await workbenchRouter(ctx)) return true
    if (await governanceRouter(ctx)) return true
    if (await adminRouter(ctx)) return true
    return false
  }
}
