// 项目路由（需鉴权）：项目 CRUD、统计、导入、拆分、归档、供应商列表
import { config } from '../config.js'
import { ApiError, created, ok, readJson } from '../lib/http.js'
import {
  getProjectStats, updateProjectCount, listProjects, createProject, updateProjectStatus,
  updateProject, importProjects, getProjectDetail, deleteProject, splitProjectDataset,
  archiveProject, importProjectTasksFromFile
} from '../services/projects.js'
import { getDashboardData } from '../services/dashboard.js'
import { listSuppliers, importProjectTasks } from '../services/tasks.js'

export async function projectRouter(ctx) {
  const { req, res, url, pathname, user } = ctx
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  if (is('GET', '/api/projects/count') || is('GET', '/api/project/count')) { ok(res, getProjectStats(user)); return true }
  if (is('GET', '/api/dashboard')) { ok(res, getDashboardData(user)); return true }
  if (is('POST', '/api/projects/count') || is('POST', '/api/project/count')) { ok(res, updateProjectCount(user, await body())); return true }
  if (is('GET', '/api/projects')) { ok(res, listProjects(user)); return true }
  if (is('GET', '/api/suppliers')) { ok(res, listSuppliers(user)); return true }

  const projId = m(/^\/api\/projects\/(\d+)$/)
  if (projId && req.method === 'GET') { ok(res, getProjectDetail(user, Number(projId[1]))); return true }

  if (is('POST', '/api/projects')) { created(res, createProject(user, await body())); return true }
  if (is('POST', '/api/projects/import')) { created(res, importProjects(user, await body())); return true }

  const tasksImport = m(/^\/api\/projects\/(\d+)\/tasks\/import$/)
  if (tasksImport && req.method === 'POST') { created(res, importProjectTasks(user, Number(tasksImport[1]), await body())); return true }

  const tasksImportFile = m(/^\/api\/projects\/(\d+)\/tasks\/import-file$/)
  if (tasksImportFile && req.method === 'POST') { created(res, await importProjectTasksFromFile(user, Number(tasksImportFile[1]), await body())); return true }

  const status = m(/^\/api\/projects\/(\d+)\/status$/)
  if (status && req.method === 'PUT') { ok(res, updateProjectStatus(user, Number(status[1]), await body())); return true }

  if (projId && req.method === 'PUT') { ok(res, updateProject(user, Number(projId[1]), await body())); return true }
  if (projId && req.method === 'DELETE') { ok(res, deleteProject(user, Number(projId[1]))); return true }

  const split = m(/^\/api\/projects\/(\d+)\/split$/)
  if (split && req.method === 'POST') { created(res, splitProjectDataset(user, Number(split[1]), await body())); return true }

  if (is('POST', '/api/projects/archive')) { ok(res, archiveProject(user, Number((await body()).projectId))); return true }
  if (is('POST', '/api/projects/parse-excel')) {
    const { parseTaskExcel } = await import('../services/excel.js')
    ok(res, await parseTaskExcel(user, await body())); return true
  }
  return false
}
