export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

export function ok(res, data = null, meta = undefined) {
  sendJson(res, 200, { code: 0, message: 'ok', data, ...(meta ? { meta } : {}) })
}

export function created(res, data = null) {
  sendJson(res, 201, { code: 0, message: 'created', data })
}

export function fail(res, error) {
  const status = error.status || 500
  sendJson(res, status, {
    code: error.code || 'INTERNAL_ERROR',
    message: status === 500 ? '服务暂时不可用' : error.message,
    ...(error.details ? { details: error.details } : {})
  })
}

export function readJson(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk)
      if (size > maxBodyBytes) {
        reject(new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求体过大'))
        req.destroy()
        return
      }
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', '请求 JSON 格式不正确'))
      }
    })
    req.on('error', reject)
  })
}
