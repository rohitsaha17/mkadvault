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
    .select("id, org_id, role, full_name, avatar_url, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    },
    profile: (profile as SessionProfile | null) ?? null,
  };
});
