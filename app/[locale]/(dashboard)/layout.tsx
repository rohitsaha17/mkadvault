// Dashboard layout — uses the per-request cached session so nested pages that
// also need the user/profile don't trigger extra Supabase round-trips.
// Auth protection (redirect if not logged in) is handled in proxy.ts,
// but we double-check here for safety.
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSession } from "@/lib/supabase/session";
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

  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <DashboardShell
      profile={session.profile as Profile | null}
      email={session.user.email}
      locale={locale}
    >
      {children}
    </DashboardShell>
  );
}
