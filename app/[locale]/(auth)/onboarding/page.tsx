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
  // straight to the dashboard. The proxy also enforces this, but we
  // double-check here in case the proxy's cookies are stale. We use the
  // admin client so RLS regressions can never hide the user's own row
  // (which is exactly how users were getting stuck on onboarding even
  // after their profile was stamped with org_id).
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.org_id) {
    redirect("/dashboard");
  }

  const userName =
    (user.user_metadata?.full_name as string | undefined) ||
    user.email?.split("@")[0] ||
    "there";

  return <OnboardingView userName={userName} />;
}
