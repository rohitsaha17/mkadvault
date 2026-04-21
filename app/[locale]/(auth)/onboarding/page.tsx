// Onboarding page — shown to authenticated users who don't have an org yet.
// Two options: Create a new organisation, or wait for an admin invite.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/session";
import { OnboardingView } from "./OnboardingView";

export const metadata = {
  title: "Get Started — OOH Platform",
};

export default async function OnboardingPage() {
  // getSession() is React.cache'd and uses the authenticated client. RLS
  // policy "user_can_select_own_profile" (migration 019) already lets a
  // user read their own profile row even without an org, so we don't need
  // a service-role call here.
  const session = await getSession();

  // Not logged in → go to login
  if (!session) {
    redirect("/login");
  }

  // Already has an org → go to dashboard. Catches the case where the proxy
  // hasn't redirected (stale cookies, edge cases).
  if (session.profile?.org_id) {
    redirect("/dashboard");
  }

  const userName =
    session.user.full_name ||
    session.user.email?.split("@")[0] ||
    "there";

  return <OnboardingView userName={userName} />;
}
