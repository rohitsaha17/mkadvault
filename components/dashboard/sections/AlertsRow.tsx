// Row 5: critical + warning alerts raised within the dashboard's date
// range. Own Suspense boundary.
//
// Alerts are time-stamped by `created_at` (and by `scheduled_for` for
// forward-scheduled reminders). We filter on `created_at` here so the
// row matches the rest of the dashboard: "what happened in this window".
// For past ranges that means historical alerts only; for future ranges
// it means scheduled ones.
import { createClient } from "@/lib/supabase/server";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import type { Alert } from "@/lib/types/database";

export async function AlertsRow({
  orgId,
  locale,
  from,
  to,
}: {
  orgId: string;
  locale: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();

  // Range boundary: we match any alert whose creation OR scheduled
  // trigger date overlaps the window. That way a payment-reminder
  // scheduled inside the range still shows up even if it was logged
  // the week before — the user cares about "alerts that are actionable
  // in this period", not "alerts strictly created in this period".
  const { data: alertRows } = await supabase
    .from("alerts")
    .select(
      "id, organization_id, user_id, target_role, alert_type, title, message, severity, related_entity_type, related_entity_id, is_read, read_at, is_dismissed, scheduled_for, sent_email, sent_whatsapp, created_at",
    )
    .eq("organization_id", orgId)
    .in("severity", ["critical", "warning"])
    .eq("is_dismissed", false)
    .eq("is_read", false)
    .or(
      `and(created_at.gte.${from},created_at.lte.${to}T23:59:59.999Z),` +
        `and(scheduled_for.gte.${from},scheduled_for.lte.${to}T23:59:59.999Z)`,
    )
    .order("created_at", { ascending: false })
    .limit(5);

  const criticalAlerts: Alert[] = (alertRows ?? []) as unknown as Alert[];
  return <DashboardAlerts alerts={criticalAlerts} locale={locale} />;
}
