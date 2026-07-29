const buckets = new Map()

const WINDOW_MS = 60 * 1000
const CLEANUP_INTERVAL = 5 * 60 * 1000

let cleanupTimer = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of buckets) {
      if (now - entry.windowStart > WINDOW_MS * 2) {
        buckets.delete(key)
      }
    }
  }, CLEANUP_INTERVAL)
  cleanupTimer.unref()
}

export function createRateLimiter({ maxRequests = 10, windowMs = WINDOW_MS } = {}) {
  startCleanup()

  return function checkLimit(key) {
    const now = Date.now()
    let entry = buckets.get(key)

    if (!entry || now - entry.windowStart > windowMs) {
      entry = { windowStart: now, count: 0 }
      buckets.set(key, entry)
    }

    entry.count++

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000)
      return { allowed: false, retryAfter }
    }

    return { allowed: true }
  }
}

export const authLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60 * 1000 })
export const apiLimiter = createRateLimiter({ maxRequests: 100, windowMs: 60 * 1000 })
