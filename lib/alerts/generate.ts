// Alert generation logic — runs server-side only (called from the cron API route)
// Uses the admin Supabase client (service role) because it reads across the whole org
// and inserts alerts without user context.
//
// DEDUPLICATION: each alert type+entity+date combo has a unique index in the DB,
// so we use INSERT ... ON CONFLICT DO NOTHING to avoid duplicates on repeated runs.

import { createAdminClient } from "@/lib/supabase/admin";
import { inr } from "@/lib/utils";
import type { AlertType, AlertSeverity } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertInsert {
  organization_id: string;
  user_id: null;
  target_role: string;
  alert_type: AlertType;
  title: string;
  message: string;
  severity: AlertSeverity;
  related_entity_type: string;
  related_entity_id: string;
  scheduled_for: string; // ISO string
  scheduled_date: string; // YYYY-MM-DD — used in dedup unique index
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): Date {
  return new Date();
}

// Returns YYYY-MM-DD string for a Date (UTC date, matches DB storage)
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function severity(daysUntil: number): AlertSeverity {
  if (daysUntil <= 1) return "critical";
  if (daysUntil <= 7) return "warning";
  return "info";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Bulk-insert alerts using ON CONFLICT DO NOTHING (dedup via unique index)
async function insertAlerts(alerts: AlertInsert[]) {
  if (!alerts.length) return;
  const supabase = createAdminClient();
  // Supabase doesn't natively expose ON CONFLICT DO NOTHING via the JS client
  // so we use the RPC / raw SQL via the admin client.
  // Workaround: insert one-by-one with ignoreDuplicates = upsert on unique cols.
  // The unique index is on (organization_id, alert_type, related_entity_id, scheduled_for::date)
  // We use .upsert() with ignoreDuplicates: true which maps to ON CONFLICT DO NOTHING.
  const { error } = await supabase
    .from("alerts")
    .upsert(alerts, { ignoreDuplicates: true });
  if (error) {
    console.error("[alerts] insert error:", error.message);
  }
}

// ─── 1. Payment Due (contract_payments upcoming) ──────────────────────────────

async function generatePaymentDueAlerts(orgId: string, advanceDays = [7, 3, 1]) {
  const supabase = createAdminClient();
  const now = today();

  // Get upcoming contract payments
  const { data: payments } = await supabase
    .from("contract_payments")
    .select(`
      id, due_date, amount_paise,
      contract:contracts(
        id, contract_type,
        site:sites(name, site_code),
        landowner:landowners(full_name),
        agency:partner_agencies(agency_name)
      )
    `)
    .eq("organization_id", orgId)
    .eq("status", "upcoming")
    .gte("due_date", now.toISOString().split("T")[0])
    .lte("due_date", addDays(now, Math.max(...advanceDays)).toISOString().split("T")[0]);

  if (!payments?.length) return;

  const alerts: AlertInsert[] = [];

  for (const p of payments) {
    const dueDate = new Date(p.due_date);
    const daysUntil = daysBetween(now, dueDate);

    if (!advanceDays.includes(daysUntil)) continue;

    const contract = p.contract as unknown as {
      id: string;
      contract_type: string;
      site: { name: string; site_code: string } | null;
      landowner: { full_name: string } | null;
      agency: { agency_name: string } | null;
    } | null;

    if (!contract) continue;

    const party = contract.contract_type === "landowner"
      ? contract.landowner?.full_name ?? "Landowner"
      : contract.agency?.agency_name ?? "Agency";

    const siteName = contract.site?.name ?? contract.site?.site_code ?? "site";

    alerts.push({
      organization_id: orgId,
      user_id: null,
      target_role: "accounts",
      alert_type: "payment_due",
      title: `Payment due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`,
      message: `${inr(p.amount_paise)} due to ${party} on ${fmtDate(p.due_date)} for ${siteName}.`,
      severity: severity(daysUntil),
      related_entity_type: "contract_payment",
      related_entity_id: p.id,
      scheduled_for: now.toISOString(),
      scheduled_date: toDateStr(now),
    });
  }

  await insertAlerts(alerts);
}

// ─── 2. Client Invoice Overdue ─────────────────────────────────────────────────

async function generateInvoiceOverdueAlerts(orgId: string, overdueDays = [1, 7, 15, 30]) {
  const supabase = createAdminClient();
  const now = today();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, due_date, total_paise,
      client:clients(company_name)
    `)
    .eq("organization_id", orgId)
    .in("status", ["sent", "partially_paid"])
    .lt("due_date", now.toISOString().split("T")[0]);

  if (!invoices?.length) return;

  const alerts: AlertInsert[] = [];

  for (const inv of invoices) {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = daysBetween(dueDate, now);

    if (!overdueDays.includes(daysOverdue)) continue;

    const clientName = (inv.client as unknown as { company_name: string } | null)?.company_name ?? "Client";

    alerts.push({
      organization_id: orgId,
      user_id: null,
      target_role: "accounts",
      alert_type: "invoice_overdue",
      title: `Invoice overdue by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}`,
      message: `Invoice ${inv.invoice_number} (${inr(inv.total_paise)}) from ${clientName} is ${daysOverdue} days past due.`,
      severity: daysOverdue >= 15 ? "critical" : daysOverdue >= 7 ? "warning" : "info",
      related_entity_type: "invoice",
      related_entity_id: inv.id,
      scheduled_for: now.toISOString(),
      scheduled_date: toDateStr(now),
    });
  }

  await insertAlerts(alerts);
}

// ─── 3. Contract Renewal Approaching ──────────────────────────────────────────

async function generateContractRenewalAlerts(orgId: string, advanceDays = [90, 60, 30]) {
  const supabase = createAdminClient();
  const now = today();
  const maxDays = Math.max(...advanceDays);

  const { data: contracts } = await supabase
    .from("contracts")
    .select(`
      id, end_date, renewal_date,
      site:sites(name, site_code),
      landowner:landowners(full_name),
      agency:partner_agencies(agency_name),
      contract_type
    `)
    .eq("organization_id", orgId)
    .eq("status", "active")
    .lte("end_date", addDays(now, maxDays).toISOString().split("T")[0])
    .gte("end_date", now.toISOString().split("T")[0]);

  if (!contracts?.length) return;

  const alerts: AlertInsert[] = [];

  for (const c of contracts) {
    const endDate = new Date(c.end_date);
    const daysUntil = daysBetween(now, endDate);

    if (!advanceDays.includes(daysUntil)) continue;

    const contract = c as unknown as {
      id: string;
      end_date: string;
      contract_type: string;
      site: { name: string; site_code: string } | null;
      landowner: { full_name: string } | null;
      agency: { agency_name: string } | null;
    };

    const party = contract.contract_type === "landowner"
      ? contract.landowner?.full_name ?? "Landowner"
      : contract.agency?.agency_name ?? "Agency";

    const siteName = contract.site?.name ?? contract.site?.site_code ?? "site";

    alerts.push({
      organization_id: orgId,
      user_id: null,
      target_role: "admin",
      alert_type: "contract_renewal",
      title: `Contract expires in ${daysUntil} days`,
      message: `Contract for ${siteName} with ${party} expires on ${fmtDate(c.end_date)}.`,
      severity: severity(daysUntil),
      related_entity_type: "contract",
      related_entity_id: c.id,
      scheduled_for: now.toISOString(),
      scheduled_date: toDateStr(now),
    });
  }

  await insertAlerts(alerts);
}

// ─── 4. Campaign Ending Soon ───────────────────────────────────────────────────

async function generateCampaignEndingAlerts(orgId: string, advanceDays = [30, 15, 7]) {
  const supabase = createAdminClient();
  const now = today();
  const maxDays = Math.max(...advanceDays);

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, campaign_name, campaign_code, end_date, client:clients(company_name)")
    .eq("organization_id", orgId)
    .eq("status", "live")
    .lte("end_date", addDays(now, maxDays).toISOString().split("T")[0])
    .gte("end_date", now.toISOString().split("T")[0]);

  if (!campaigns?.length) return;

  const alerts: AlertInsert[] = [];

  for (const camp of campaigns) {
    const endDate = new Date(camp.end_date);
    const daysUntil = daysBetween(now, endDate);
    if (!advanceDays.includes(daysUntil)) continue;

    const clientName = (camp.client as unknown as { company_name: string } | null)?.company_name ?? "Client";

    alerts.push({
      organization_id: orgId,
      user_id: null,
      target_role: "sales_manager",
      alert_type: "campaign_ending",
      title: `Campaign ending in ${daysUntil} days`,
      message: `"${camp.campaign_name}" for ${clientName} ends on ${fmtDate(camp.end_date)}.`,
      severity: severity(daysUntil),
      related_entity_type: "campaign",
      related_entity_id: camp.id,
      scheduled_for: now.toISOString(),
      scheduled_date: toDateStr(now),
    });
  }

  await insertAlerts(alerts);
}

// ─── 5. Municipal Permission Expiry ───────────────────────────────────────────

async function generateMunicipalExpiryAlerts(orgId: string, advanceDays = [60, 30]) {
  const supabase = createAdminClient();
  const now = today();
  const maxDays = Math.max(...advanceDays);

  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, site_code, municipal_permission_expiry")
    .eq("organization_id", orgId)
    .not("municipal_permission_expiry", "is", null)
    .lte("municipal_permission_expiry", addDays(now, maxDays).toISOString().split("T")[0])
    .gte("municipal_permission_expiry", now.toISOString().split("T")[0]);

  if (!sites?.length) return;

  const alerts: AlertInsert[] = [];

  for (const site of sites) {
    if (!site.municipal_permission_expiry) continue;
    const expiryDate = new Date(site.municipal_permission_expiry);
    const daysUntil = daysBetween(now, expiryDate);
    if (!advanceDays.includes(daysUntil)) continue;

    alerts.push({
      organization_id: orgId,
      user_id: null,
      target_role: "operations_manager",
      alert_type: "municipal_expiry",
      title: `Municipal permit expiring in ${daysUntil} days`,
      message: `Site ${site.site_code ?? site.name} municipal permission expires on ${fmtDate(site.municipal_permission_expiry)}.`,
      severity: daysUntil <= 30 ? "critical" : "warning",
      related_entity_type: "site",
      related_entity_id: site.id,
      scheduled_for: now.toISOString(),
      scheduled_date: toDateStr(now),
    });
  }

  await insertAlerts(alerts);
}

// ─── 6. Mounting Scheduled Tomorrow ───────────────────────────────────────────

async function generateMountingAlerts(orgId: string) {
  const supabase = createAdminClient();
  const tomorrow = addDays(today(), 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const { data: campSites } = await supabase
    .from("campaign_sites")
    .select(`
      id, mounting_date,
      site:sites(name, site_code),
      campaign:campaigns(campaign_name, client:clients(company_name))
    `)
    .eq("organization_id", orgId)
    .eq("mounting_date", tomorrowStr);

  if (!campSites?.length) return;

  const alerts: AlertInsert[] = [];

  for (const cs of campSites) {
    const csTyped = cs as unknown as {
      id: string;
      mounting_date: string;
      site: { name: string; site_code: string } | null;
      campaign: { campaign_name: string; client: { company_name: string } | null } | null;
    };

    const siteName = csTyped.site?.name ?? csTyped.site?.site_code ?? "site";
    const campaignName = csTyped.campaign?.campaign_name ?? "campaign";
    const clientName = csTyped.campaign?.client?.company_name ?? "";

    alerts.push({
      organization_id: orgId,
      user_id: null,
      target_role: "operations_manager",
      alert_type: "mounting_scheduled",
      title: "Mounting scheduled for tomorrow",
      message: `Mounting at ${siteName} for "${campaignName}"${clientName ? ` (${clientName})` : ""} is scheduled for ${fmtDate(csTyped.mounting_date)}.`,
      severity: "info",
      related_entity_type: "campaign",
      related_entity_id: csTyped.campaign ? undefined as unknown as string : csTyped.id,
      scheduled_for: today().toISOString(),
      scheduled_date: toDateStr(today()),
    });
  }

  await insertAlerts(alerts);
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function generateAlertsForOrg(orgId: string): Promise<void> {
  await Promise.all([
    generatePaymentDueAlerts(orgId),
    generateInvoiceOverdueAlerts(orgId),
    generateContractRenewalAlerts(orgId),
    generateCampaignEndingAlerts(orgId),
    generateMunicipalExpiryAlerts(orgId),
    generateMountingAlerts(orgId),
  ]);
}

export async function generateAlertsForAllOrgs(): Promise<{ processed: number; errors: string[] }> {
  const supabase = createAdminClient();
  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, name");

  if (error || !orgs) {
    return { processed: 0, errors: [error?.message ?? "Failed to load orgs"] };
  }

  const errors: string[] = [];
  let processed = 0;

  for (const org of orgs) {
    try {
      await generateAlertsForOrg(org.id);
      processed++;
    } catch (err) {
      errors.push(`Org ${org.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { processed, errors };
}
