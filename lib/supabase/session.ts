// Per-request cached session + profile lookup — now with a second layer
// of caching across requests for the profile row.
//
// Why two layers:
//   * React.cache()         → memoize within a single render tree so
//                             every Server Component in one page render
//                             only triggers one Supabase round-trip.
//   * unstable_cache(ttl=30)→ memoize the PROFILE SELECT (keyed by
//                             user id) across requests. Profile data
//                             (name, role, org, avatar) changes rarely;
//                             a 30 s TTL kills one round-trip per
//                             navigation while still reflecting admin
//                             role changes within half a minute.
//
// We DO NOT cross-request-cache the getUser() call — that's the token
// validation step and must run fresh every request for security.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "./server";
import { createAdminClient } from "./admin";

export type SessionProfile = {
  id: string;
  org_id: string | null;
  role: string | null;
  // All roles this user holds (single-role users have [role]; exec+accounts
  // combo users have both). Always check this array for permissions that
  // either member of the combo can grant.
  roles: string[];
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
};

export type SessionUser = {
  id: string;
  email: string | null;
  full_name: string | null;
};

export type Session = {
  user: SessionUser;
  profile: SessionProfile | null;
} | null;

// Fetch a profile row by user id. Wrapped in unstable_cache so repeated
// lookups for the same user id within 30 s skip the DB round-trip. Uses
// the admin client so that cache hits don't depend on RLS policy state.
//
// Tags: the cached entry is tagged with `profile:<userId>` so code that
// mutates a profile can call revalidateTag(`profile:${userId}`) to
// invalidate immediately — useful for the settings screen where the
// user updates their own name or avatar.
type RawProfile = Omit<SessionProfile, "roles"> & {
  roles?: string[] | null;
};

async function fetchProfileByUserId(userId: string): Promise<RawProfile | null> {
  // Prefer admin client so RLS regressions / migration gaps can't hide
  // the user's own row. Falls back silently to the regular client if the
  // service role key isn't set in this environment (e.g. preview deploys).
  const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = hasServiceRoleKey ? createAdminClient() : await createClient();

  // Try full select first. If migration 020 hasn't been applied, `roles`
  // column doesn't exist → retry without it so the app still boots.
  const res = await client
    .from("profiles")
    .select("id, org_id, role, roles, full_name, avatar_url, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (res.error && /roles/i.test(res.error.message)) {
    const fallback = await client
      .from("profiles")
      .select("id, org_id, role, full_name, avatar_url, is_active")
      .eq("id", userId)
      .maybeSingle();
    return (fallback.data as RawProfile | null) ?? null;
  }
  return (res.data as RawProfile | null) ?? null;
}

// Cross-request cache layer. 30 s TTL — profile data rarely changes,
// and role flips / profile edits are explicitly invalidated via
// revalidateTag in the actions that change them.
const getCachedProfile = unstable_cache(
  fetchProfileByUserId,
  ["session-profile"],
  {
    revalidate: 30,
    tags: ["session-profiles"],
  },
);

/**
 * Returns the current user + their profile row. getUser() runs fresh
 * every request (it validates the auth token). The profile fetch is
 * cached cross-request for 30 s per user id, and within-request via
 * React.cache so repeated calls in one render tree share the result.
 */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await getCachedProfile(user.id);

  // Normalise: if the DB returned a row with no `roles` populated,
  // fall back to `[role]` so permission checks keep working.
  const normalised: SessionProfile | null = profile
    ? {
        ...(profile as SessionProfile),
        roles:
          Array.isArray(profile.roles) && profile.roles.length > 0
            ? profile.roles
            : [profile.role ?? "viewer"],
      }
    : null;

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    profile: normalised,
  };
});

/**
 * Call this from any server action that mutates a profile row (name
 * change, avatar upload, role flip, activation toggle, delete) so the
 * 30 s cached copy is invalidated immediately for the next request.
 * Import from lib/supabase/session alongside getSession.
 *
 * Uses Next.js 16's updateTag (the single-arg replacement for the old
 * revalidateTag — in Next 16 revalidateTag requires a cache profile).
 */
export async function invalidateSessionProfile() {
  const { updateTag } = await import("next/cache");
  updateTag("session-profiles");
}
