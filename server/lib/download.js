// 文件流式下载工具（统一处理 mime/Content-Disposition/路径穿越防护）
import fs from 'node:fs'
import path from 'node:path'
import { ApiError } from './http.js'

const DOWNLOAD_MIME = {
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
}

/**
 * 校验文件位于 baseDir 内且存在，然后以附件形式流式输出
 * @param {import('node:http').ServerResponse} res
 * @param {string} baseDir 允许访问的根目录
 * @param {string} relPath 相对路径（可含子目录，如 a/b/c.zip）
 * @param {string} downloadName 下载展示的文件名
 */
export function streamDownload(res, baseDir, relPath, downloadName) {
  const rootDir = path.resolve(baseDir)
  const filePath = path.resolve(rootDir, ...String(relPath).split('/'))
  const relativePath = path.relative(rootDir, filePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !fs.existsSync(filePath)) {
    throw new ApiError(404, 'NOT_FOUND', '文件不存在')
  }
  const ext = path.extname(filePath).toLowerCase()
  const encoded = encodeURIComponent(downloadName || path.basename(filePath))
  res.writeHead(200, {
    'Content-Type': DOWNLOAD_MIME[ext] || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`
  })
  fs.createReadStream(filePath).pipe(res)
}
