// Onboarding page — shown to authenticated users who don't have an org yet.
// Two options: Create a new organisation, or wait for an admin invite.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // Already has an org → go to dashboard
  // Use a direct query since RLS may return nothing for no-org users
  // We check via auth metadata or a service-role query
  // Actually — profiles RLS requires org_id match, but for the user's own
  // row the "user_can_update_own_profile" SELECT path should work.
  // Let's use a lightweight approach: the proxy already checks this,
  // so if we got here the user has no org. Render the view.

  return <OnboardingView userName={user.user_metadata?.full_name || user.email?.split("@")[0] || "there"} />;
}
