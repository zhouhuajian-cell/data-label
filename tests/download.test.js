import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Writable } from 'node:stream'
import { streamDownload } from '../server/lib/download.js'
import { ApiError } from '../server/lib/http.js'

function createMockResponse() {
  const chunks = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    }
  })
  res.statusCode = null
  res.headers = null
  res.chunks = chunks
  res.writeHead = function writeHead(statusCode, headers) {
    this.statusCode = statusCode
    this.headers = headers
  }
  return res
}

function waitForFinish(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

test('streamDownload serves files inside the configured base directory', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-download-'))
  try {
    fs.writeFileSync(path.join(baseDir, 'sample.csv'), 'id,name\n1,test\n')
    const res = createMockResponse()

    streamDownload(res, baseDir, 'sample.csv', 'report.csv')
    await waitForFinish(res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Content-Type'], 'text/csv')
    assert.equal(res.headers['Content-Disposition'], "attachment; filename*=UTF-8''report.csv")
    assert.equal(Buffer.concat(res.chunks).toString(), 'id,name\n1,test\n')
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true })
  }
})

test('streamDownload rejects traversal outside the configured base directory', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyun-download-parent-'))
  const baseDir = path.join(parentDir, 'uploads')
  try {
    fs.mkdirSync(baseDir)
    fs.writeFileSync(path.join(parentDir, 'secret.csv'), 'secret')

    assert.throws(
      () => streamDownload(createMockResponse(), baseDir, '../secret.csv', 'secret.csv'),
      error => error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND'
    )
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true })
  }
})
