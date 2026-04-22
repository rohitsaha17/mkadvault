// Row 5: critical + warning alerts for the org. Own Suspense boundary.
import { createClient } from "@/lib/supabase/server";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import type { Alert } from "@/lib/types/database";

export async function AlertsRow({
  orgId,
  locale,
}: {
  orgId: string;
  locale: string;
}) {
  const supabase = await createClient();

  const { data: alertRows } = await supabase
    .from("alerts")
    .select(
      "id, organization_id, user_id, target_role, alert_type, title, message, severity, related_entity_type, related_entity_id, is_read, read_at, is_dismissed, scheduled_for, sent_email, sent_whatsapp, created_at",
    )
    .eq("organization_id", orgId)
    .in("severity", ["critical", "warning"])
    .eq("is_dismissed", false)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(5);

  const criticalAlerts: Alert[] = (alertRows ?? []) as unknown as Alert[];
  return <DashboardAlerts alerts={criticalAlerts} locale={locale} />;
}
