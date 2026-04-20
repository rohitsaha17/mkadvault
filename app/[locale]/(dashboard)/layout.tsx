// Dashboard layout — fetches the user's profile and passes it to the client shell.
// Auth protection (redirect if not logged in) is handled in proxy.ts,
// but we double-check here for safety.
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./DashboardShell";
import type { Profile } from "@/lib/types/database";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Verify the user is authenticated — getUser() does a server-side token check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch the user's profile for display in sidebar + topbar
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, org_id, role, full_name, avatar_url, is_active")
    .eq("id", user.id)
    .single();

  return (
    <DashboardShell profile={profile as Profile | null} locale={locale}>
      {children}
    </DashboardShell>
  );
}
