// 数据治理路由（需鉴权）：治理数据集、场景维度、打标队列、生产数据集
import { config } from '../config.js'
import { created, ok, readJson } from '../lib/http.js'
import {
  importDataset, importDatasetFromFile, listGovernedDatasets, getDatasetDetail,
  updateDatasetStatus, tagGovernedItem, batchTagGovernedItems, previewSplit,
  deleteDataset, deleteGovernedItem
} from '../services/governance.js'
import {
  getScenarioDimensions, saveScenarioDimension, deleteScenarioDimension,
  getTaggingQueue, saveItemTags, batchSaveTags
} from '../services/tagging.js'
import { listDatasets, getDatasetItems, exportDataset } from '../services/datasets.js'

export async function governanceRouter(ctx) {
  const { req, res, pathname, user } = ctx
  const body = () => readJson(req, config.maxBodyBytes)
  const m = (pattern) => pathname.match(pattern)
  const is = (method, p) => req.method === method && pathname === p

  // ===== 数据场景维度 / 打标 =====
  if (is('GET', '/api/scenario-dimensions')) { ok(res, getScenarioDimensions(user)); return true }
  if (is('POST', '/api/scenario-dimensions')) { ok(res, saveScenarioDimension(user, await body())); return true }

  const dim = m(/^\/api\/scenario-dimensions\/(\d+)$/)
  if (dim && req.method === 'POST') { ok(res, saveScenarioDimension(user, { ...(await body()), id: Number(dim[1]) })); return true }
  if (dim && req.method === 'DELETE') { ok(res, deleteScenarioDimension(user, Number(dim[1]))); return true }

  const tagging = m(/^\/api\/tasks\/(\d+)\/tagging$/)
  if (tagging && req.method === 'GET') { ok(res, getTaggingQueue(user, Number(tagging[1]))); return true }

  const itemTags = m(/^\/api\/items\/(\d+)\/tags$/)
  if (itemTags && req.method === 'PUT') { ok(res, saveItemTags(user, Number(itemTags[1]), await body())); return true }

  if (is('POST', '/api/items/batch-tags')) { ok(res, batchSaveTags(user, await body())); return true }

  // ===== 数据治理中心 =====
  if (is('POST', '/api/governance/preview-split')) { ok(res, previewSplit(user, await body())); return true }
  if (is('GET', '/api/governance/datasets')) { ok(res, listGovernedDatasets(user)); return true }

  const govDs = m(/^\/api\/governance\/datasets\/(\d+)$/)
  if (govDs && req.method === 'GET') { ok(res, getDatasetDetail(user, Number(govDs[1]))); return true }
  if (govDs && req.method === 'DELETE') { ok(res, deleteDataset(user, Number(govDs[1]))); return true }

  if (is('POST', '/api/governance/import')) { created(res, importDataset(user, await body())); return true }
  if (is('POST', '/api/governance/import-file')) { created(res, await importDatasetFromFile(user, await body())); return true }

  const govStatus = m(/^\/api\/governance\/datasets\/(\d+)\/status$/)
  if (govStatus && req.method === 'PUT') { ok(res, updateDatasetStatus(user, Number(govStatus[1]), await body())); return true }

  const govItem = m(/^\/api\/governance\/items\/(\d+)\/tag$/)
  if (govItem && req.method === 'PUT') { ok(res, tagGovernedItem(user, Number(govItem[1]), await body())); return true }

  if (is('POST', '/api/governance/items/batch-tag')) { ok(res, batchTagGovernedItems(user, await body())); return true }

  const govItemDel = m(/^\/api\/governance\/items\/(\d+)$/)
  if (govItemDel && req.method === 'DELETE') { ok(res, deleteGovernedItem(user, Number(govItemDel[1]))); return true }

  // ===== 生产数据集（算法视角）=====
  if (is('GET', '/api/datasets')) { ok(res, listDatasets(user)); return true }

  const dsItems = m(/^\/api\/datasets\/(\d+)\/items$/)
  if (dsItems && req.method === 'GET') { ok(res, getDatasetItems(user, Number(dsItems[1]))); return true }

  const dsExport = m(/^\/api\/datasets\/(\d+)\/export$/)
  if (dsExport && req.method === 'GET') {
    const ds = exportDataset(user, Number(dsExport[1]))
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ds.fileName)}`
    })
    res.end(ds.content)
    return true
  }
  return false
}
