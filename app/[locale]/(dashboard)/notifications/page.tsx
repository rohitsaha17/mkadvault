// Full notifications page — table of all alerts with filters and bulk actions
import { setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import type { Alert } from "@/lib/types/database";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const session = await getSession();
  if (!session) return <p className="p-6 text-sm text-muted-foreground">Not authenticated.</p>;

  const { user, profile } = session;

  if (!profile) return <p className="p-6 text-sm text-muted-foreground">Profile not found.</p>;

  // Fetch last 200 alerts for this user (by user_id OR role), not dismissed
  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("organization_id", profile.org_id)
    .eq("is_dismissed", false)
    .or(`user_id.eq.${user.id},target_role.eq.${profile.role}`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return <p className="p-6 text-sm text-red-500">Failed to load notifications: {error.message}</p>;
  }

  return (
    <NotificationsClient
      alerts={(alerts ?? []) as Alert[]}
      locale={locale}
    />
  );
}
