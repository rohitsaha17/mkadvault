// Accept Invite — shown to a newly-invited team member after they click
// the invite link and the auth callback exchanges their code for a session.
//
// Flow:
//   1. Admin invites user → user_metadata.needs_password_setup = true
//   2. User clicks invite email → /auth/callback verifies the token
//   3. Callback detects needs_password_setup and redirects here
//   4. User sets a password (email is already known from the session)
//   5. We clear needs_password_setup and send them to /dashboard
//
// Server component: fetches the current user + their org name so we can
// render a warm "Welcome to {org}" heading. Lookups are wrapped in
// try/catch so a missing SUPABASE_SERVICE_ROLE_KEY or transient DB error
// never crashes this page — the invite screen must always render.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AcceptInviteForm } from "./AcceptInviteForm";

export const metadata = { title: "Accept Invite" };

export default async function AcceptInvitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // If this user doesn't need password setup, they're not invite-flow —
  // send them onward. org_id may or may not be set, but they've already
  // been through the normal auth callback.
  const needsPasswordSetup =
    user.user_metadata?.needs_password_setup === true;
  if (!needsPasswordSetup) {
    redirect("/dashboard");
  }

  // Fetch profile + org name for the welcome message. Both lookups are
  // best-effort: if anything fails we still render the form (with a
  // generic greeting) so the user is never blocked from setting a password.
  let fullName: string | null = null;
  let phone: string | null = null;
  let orgName: string | null = null;

  try {
    // Prefer the admin client so RLS regressions don't hide the row, but
    // fall back to the authenticated client if the service role key is
    // missing from this environment.
    const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const client = hasServiceRoleKey ? createAdminClient() : supabase;

    const { data: profile } = await client
      .from("profiles")
      .select("org_id, full_name, phone")
      .eq("id", user.id)
      .maybeSingle();

    fullName = profile?.full_name ?? null;
    phone = profile?.phone ?? null;

    if (profile?.org_id) {
      const { data: org } = await client
        .from("organizations")
        .select("name")
        .eq("id", profile.org_id)
        .maybeSingle();
      orgName = org?.name ?? null;
    }
  } catch (err) {
    // Log but never throw — the form must render regardless.
    console.error("[accept-invite] profile/org lookup failed:", err);
  }

  // Fallback: if the profile didn't have a full_name yet (trigger may not
  // have copied it from auth metadata), use what the admin typed into the
  // invite form — it's stored on user_metadata.full_name.
  if (!fullName) {
    const metaName = user.user_metadata?.full_name;
    if (typeof metaName === "string" && metaName.trim()) {
      fullName = metaName.trim();
    }
  }

  return (
    <AcceptInviteForm
      email={user.email ?? ""}
      fullName={fullName}
      phone={phone}
      orgName={orgName}
    />
  );
}
