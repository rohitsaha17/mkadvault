// Per-request cached session + profile lookup.
//
// Server Components and Server Actions often each call `supabase.auth.getUser()`
// and then `profiles.select(...)` — that's 2-4 round-trips to Supabase every
// page navigation (layout, page, nested pages all ask independently).
//
// `React.cache()` memoizes the result within a single request, so repeated
// callers in the same render tree share one result. Separate requests are
// isolated, so there's no risk of leaking sessions between users.
import { cache } from "react";
import { createClient } from "./server";

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

/**
 * Returns the current user + their profile row, cached for the duration of
 * the request. Returns null if not authenticated.
 *
 * Call this from any Server Component or Server Action. Repeated calls
 * within the same request are free.
 */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, org_id, role, roles, full_name, avatar_url, is_active")
    .eq("id", user.id)
    .maybeSingle();

  // Normalise: if the DB returned a row with no `roles` populated (e.g.
  // because migration 020 hasn't run yet against this instance), fall back
  // to `[role]` so permission checks keep working.
  const normalised: SessionProfile | null = profile
    ? {
        ...(profile as SessionProfile),
        roles:
          Array.isArray((profile as SessionProfile).roles) &&
          (profile as SessionProfile).roles.length > 0
            ? (profile as SessionProfile).roles
            : [(profile as SessionProfile).role ?? "viewer"],
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
