// Onboarding page — shown to authenticated users who don't have an org yet.
// Two options: Create a new organisation, or wait for an admin invite.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OnboardingView } from "./OnboardingView";

export const metadata = {
  title: "Get Started — OOH Platform",
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in → go to login
  if (!user) {
    redirect("/login");
  }

  // Defensive check: if this user already belongs to an org, send them
  // straight to the dashboard. The proxy also enforces this, but relying on
  // it alone was letting stale cookies / edge cases leave users stuck on
  // the onboarding screen. We use the admin client because profile-row RLS
  // for users without org context can hide the user's own row depending on
  // the SELECT policy — the admin client sidesteps that for this read-only
  // check keyed on the authenticated user's id.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.org_id) {
    redirect("/dashboard");
  }

  return <OnboardingView userName={user.user_metadata?.full_name || user.email?.split("@")[0] || "there"} />;
}
