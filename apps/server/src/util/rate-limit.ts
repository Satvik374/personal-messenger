export interface RateLimiter {
  /** Returns true when the call is allowed. */
  check(key: string): boolean
  reset(): void
}

/** Tiny fixed-window limiter. Correct here because the server runs as one instance. */
export function createRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()

  function prune(now: number): void {
    if (buckets.size < 5000) return
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
  }

  return {
    check(key: string): boolean {
      const now = Date.now()
      prune(now)
      const bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs })
        return true
      }
      if (bucket.count >= options.max) return false
      bucket.count += 1
      return true
    },
    reset(): void {
      buckets.clear()
    },
  }
}
