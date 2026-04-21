// Accept Invite — shown to a newly-invited team member after they click
// the invite link and the auth callback exchanges their code for a session.
//
// Flow:
//   1. Admin invites user → user_metadata.needs_password_setup = true
//   2. User clicks magic-link email → /auth/callback exchanges code
//   3. Callback detects needs_password_setup and redirects here
//   4. User confirms the email they were invited under, sets a password
//   5. We clear needs_password_setup and send them to /dashboard
//
// Server component: fetches the current user + their org name so we can
// render a warm "Welcome to {org}" heading and show the invite email.
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

  // Fetch the org name for the welcome message. Use admin client so RLS
  // regressions can't break the lookup.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("org_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  let orgName: string | null = null;
  if (profile?.org_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", profile.org_id)
      .maybeSingle();
    orgName = org?.name ?? null;
  }

  return (
    <AcceptInviteForm
      email={user.email ?? ""}
      fullName={profile?.full_name ?? null}
      orgName={orgName}
    />
  );
}
