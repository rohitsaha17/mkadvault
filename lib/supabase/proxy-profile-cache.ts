// Tiny in-memory TTL cache for the proxy's profile lookup.
//
// Why this exists:
//   The proxy runs on every protected-route navigation and, until now,
//   fetched the user's profile row from Supabase every single time
//   just to check org_id / role / is_active. That's one extra DB
//   round-trip on every page nav — and because the proxy sits in
//   front of the server render, that round-trip is in the critical
//   path. Multiply by 5–10 navs/minute and it's a real chunk of
//   perceived latency.
//
// What this does:
//   Memoise the tiny `{ org_id, role, roles, is_active }` tuple per
//   user_id for 30 seconds. The first nav in a 30 s window hits the
//   DB; the rest read from the Map. Role flips, deactivation and the
//   onboarding→org transition all reflect within half a minute, which
//   is the same freshness window session.ts already enforces, so the
//   two caches stay in lockstep.
//
// Why a Map, not unstable_cache:
//   Next's unstable_cache has caveats in edge middleware. A plain
//   module-scoped Map is portable to any runtime and gives us the
//   per-instance dedupe we actually need. Each warm worker holds its
//   own copy — on Vercel that's typically a handful of instances per
//   deployment, so we'd service hundreds of navs with a single DB hit
//   per instance per 30 s.
//
// Safety:
//   The cached row is a tiny plain object, there's a hard cap on
//   entries (we prune the oldest when we exceed MAX_ENTRIES), and
//   nothing else in the app relies on reading from this cache — the
//   proxy's fetchProfile fallback always runs if the entry has
//   expired or isn't present.

export type CachedProfile = {
  org_id: string | null;
  role: string;
  roles: string[] | null;
  is_active: boolean | null;
};

type Entry = {
  profile: CachedProfile | null;
  expiresAt: number;
};

const TTL_MS = 30_000;
const MAX_ENTRIES = 2_000;

// Module-scoped Map persists for the lifetime of the worker instance.
const cache = new Map<string, Entry>();

export function getCachedProxyProfile(userId: string): CachedProfile | null | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined; // not cached — caller fetches
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return undefined;
  }
  return entry.profile;
}

export function setCachedProxyProfile(
  userId: string,
  profile: CachedProfile | null,
): void {
  // Simple size cap: when we hit the limit, drop the oldest entry
  // (Map iteration order is insertion order in JS, so delete the
  // first key). This is O(1) on average and keeps memory bounded on
  // a long-running worker that's seen many distinct users.
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(userId, { profile, expiresAt: Date.now() + TTL_MS });
}

/**
 * Invalidate a user's cached proxy profile. Call from server actions
 * that change role / org / active state so the next proxy pass sees
 * the new values immediately rather than waiting ~30 s.
 */
export function invalidateCachedProxyProfile(userId: string): void {
  cache.delete(userId);
}
