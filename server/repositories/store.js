import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as data from './data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbDir = path.resolve(__dirname, '../data')
const dbFile = path.join(dbDir, 'db.json')

// 需要持久化的集合（保持数组引用不变，仅替换元素，避免影响既有 import）
const KEYS = ['users', 'suppliers', 'tasks', 'taskLogs', 'submissions', 'auditLogs', 'taskItems', 'projects', 'workSessions', 'settlements', 'notifications', 'scenarioDimensions', 'governedDatasets', 'governedItems', 'feishuConfig']

export function loadStore() {
  if (!fs.existsSync(dbFile)) return false
  try {
    const json = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    for (const key of KEYS) {
      if (Array.isArray(json[key]) && Array.isArray(data[key])) {
        data[key].splice(0, data[key].length, ...json[key])
      }
    }
    return true
  } catch (error) {
    console.error('加载本地数据文件失败，使用内置种子数据:', error.message)
    return false
  }
}

let timer = null
const MAX_SAVE_RETRY = 3

// 实际落盘；失败时按 500ms/1000ms/2000ms 间隔自动重试，最多 MAX_SAVE_RETRY 次
function persist(attempt = 0) {
  try {
    const out = {}
    for (const key of KEYS) out[key] = data[key]
    fs.mkdirSync(dbDir, { recursive: true })
    fs.writeFileSync(dbFile, JSON.stringify(out))
    if (attempt > 0) console.log('本地数据保存成功（第 ' + attempt + ' 次重试后）')
  } catch (error) {
    if (attempt < MAX_SAVE_RETRY) {
      console.error('保存本地数据文件失败（第 ' + (attempt + 1) + ' 次，稍后重试）:', error.code || '', error.message)
      setTimeout(() => persist(attempt + 1), 500 * (attempt + 1))
    } else {
      console.error('保存本地数据文件失败（已重试 ' + MAX_SAVE_RETRY + ' 次仍失败，请检查 db.json 是否被其它程序占用）:', error.code || '', error.message)
    }
  }
}

export function saveStore() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => persist(0), 300)
}
