import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as data from './data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbDir = path.resolve(__dirname, '../data')
const dbFile = path.join(dbDir, 'db.json')

// 需要持久化的集合（保持数组引用不变，仅替换元素，避免影响既有 import）
const KEYS = ['users', 'suppliers', 'tasks', 'taskLogs', 'submissions', 'auditLogs', 'taskItems', 'projects', 'workSessions', 'settlements', 'notifications', 'scenarioDimensions', 'governedDatasets', 'governedItems']

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
export function saveStore() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      const out = {}
      for (const key of KEYS) out[key] = data[key]
      fs.mkdirSync(dbDir, { recursive: true })
      fs.writeFileSync(dbFile, JSON.stringify(out))
    } catch (error) {
      console.error('保存本地数据文件失败:', error.message)
    }
  }, 300)
}
