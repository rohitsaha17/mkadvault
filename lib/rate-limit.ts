// Lightweight in-process rate limiter.
//
// Why not @vercel/kv / Upstash: this app runs on Vercel with serverless
// functions that have a per-instance memory store; on cold starts the
// counter resets, which is fine for our threat model (slow down a
// single attacker per region) — we're not trying to enforce a global
// quota, just stop a single client from burning AI credits in a loop.
// If we ever need a global quota the function signature here matches
// what an Upstash adapter would expose, so swap-in is straightforward.
//
// Usage:
//   const result = await rateLimit({ key: `extract:${orgId}`, limit: 3, windowMs: 60 * 60 * 1000 });
//   if (!result.allowed) return NextResponse.json({ error: result.reason }, { status: 429 });

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically purge expired buckets so the map doesn't grow unbounded
// across long-running serverless instances. Cheap O(n) sweep — only
// runs when we add a new key after a 5-minute idle.
let lastSweep = 0;
function sweepExpired(now: number): void {
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitOptions {
  // Cache key — typically `${routeName}:${orgId or userId}`.
  key: string;
  // Max requests within the window.
  limit: number;
  // Window in milliseconds.
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  reason?: string;
}

export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);

  const existing = buckets.get(opts.key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.limit - 1, resetAt: now + opts.windowMs };
  }

  if (existing.count >= opts.limit) {
    const seconds = Math.ceil((existing.resetAt - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      reason: `Rate limit hit. Try again in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}.`,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: opts.limit - existing.count,
    resetAt: existing.resetAt,
  };
}
