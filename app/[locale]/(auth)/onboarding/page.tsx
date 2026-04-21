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

  // Defensive check: if this user already belongs to an org, send them to
  // the dashboard. Use the admin client when available so RLS regressions
  // can never hide the user's own row; fall back to the authenticated
  // client if the service-role key isn't configured.
  let orgId: string | null = null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .maybeSingle();
      orgId = data?.org_id ?? null;
    } catch (err) {
      console.error("[onboarding] admin lookup failed, falling back:", err);
    }
  }
  if (!orgId) {
    const { data } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    orgId = data?.org_id ?? null;
  }

  if (orgId) {
    redirect("/dashboard");
  }

  const userName =
    (user.user_metadata?.full_name as string | undefined) ||
    user.email?.split("@")[0] ||
    "there";

  return <OnboardingView userName={userName} />;
}
