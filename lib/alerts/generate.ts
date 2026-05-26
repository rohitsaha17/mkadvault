// Cron-driven alert generators. Each function below runs once per org
// per day from /api/cron/generate-alerts and fires `notify()` for the
// events it owns. The dispatcher fans each event out to the right
// audience (role + scope) and sends emails to whoever has the channel
// turned on.
//
// Why notify() instead of direct alert inserts:
//   • Single source of truth for audience policy (lib/notifications/
//     audience.ts) — keeps cron and transactional triggers consistent.
//   • Emails go out automatically — no separate sender to maintain.
//   • Dedup is handled inside notify() via the per-user unique index.
//
// Dedup behaviour: notify() upserts on
//   (organization_id, alert_type, related_entity_id, scheduled_date, user_id)
// so a daily cron re-run on the same entity is a no-op for in-app rows.
// Emails will resend if the cron is invoked twice in one day; the Resend
// API tolerates that and recipients won't notice in practice (we only
// fire when the trigger window matches).

import { createAdminClient } from "@/lib/supabase/admin";
import { inr } from "@/lib/utils";
import { notify } from "@/lib/notifications/dispatch";
import type { NotificationEvent, Severity } from "@/lib/notifications/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): Date {
  return new Date();
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// Pick a severity tier based on how close (or far past) a deadline is.
// daysUntil < 0 is treated as "overdue" and stays critical.
function severityForCountdown(daysUntil: number): Severity {
  if (daysUntil <= 1) return "critical";
  if (daysUntil <= 7) return "warning";
  return "info";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Postgrest's embedded-relation typing widens single-row joins into an
// "object OR array" union. Collapse to the object form for ergonomics.
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

// Fire-and-forget wrapper that swallows individual generator failures so
// one buggy generator doesn't take down the rest of the daily run.
async function safeNotify(args: Parameters<typeof notify>[0]) {
  try {
    await notify(args);
  } catch (err) {
    console.warn("[alerts] notify failed for", args.eventType, err);
  }
}

// ─── 1. Payment Due (contract_payments upcoming) ──────────────────────────────

async function generatePaymentDueAlerts(orgId: string, advanceDays = [7, 3, 1]) {
  const supabase = createAdminClient();
  const now = today();

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
    .lte(
      "due_date",
      addDays(now, Math.max(...advanceDays)).toISOString().split("T")[0],
    );

  if (!payments?.length) return;

  for (const p of payments) {
    const dueDate = new Date(p.due_date);
    const daysUntil = daysBetween(now, dueDate);
    if (!advanceDays.includes(daysUntil)) continue;

    // Postgrest infers `contract` as an array even for to-one relations;
    // go through `unknown` so TS accepts the narrower union we want.
    const contract = pickOne(
      p.contract as unknown as
        | {
            id: string;
            contract_type: string;
            site:
              | { name: string; site_code: string }
              | { name: string; site_code: string }[]
              | null;
            landowner:
              | { full_name: string }
              | { full_name: string }[]
              | null;
            agency:
              | { agency_name: string }
              | { agency_name: string }[]
              | null;
          }
        | null,
    );
    if (!contract) continue;

    const site = pickOne(contract.site);
    const landowner = pickOne(contract.landowner);
    const agency = pickOne(contract.agency);
    const party =
      contract.contract_type === "landowner"
        ? landowner?.full_name ?? "Landowner"
        : agency?.agency_name ?? "Agency";
    const siteName = site?.name ?? site?.site_code ?? "site";
    const amountLabel = inr(p.amount_paise);

    await safeNotify({
      organizationId: orgId,
      eventType: "payment_due",
      entityType: "contract_payment",
      entityId: p.id,
      severity: severityForCountdown(daysUntil),
      title: `Payment due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} — ${amountLabel}`,
      message: `${amountLabel} due to ${party} on ${fmtDate(p.due_date)} for ${siteName}.`,
      data: {
        Counterparty: party,
        Site: siteName,
        Amount: amountLabel,
        "Due date": fmtDate(p.due_date),
      },
    });
  }
}

// ─── 2. Payment Overdue (contract_payments past due) ──────────────────────────
// New generator — covers landowner / agency rent that we owe but didn't
// pay on time. Lookback window is 30 days so we don't keep nagging
// forever; accounts gets nudges at 1 / 7 / 15 / 30 days late.

async function generatePaymentOverdueAlerts(
  orgId: string,
  overdueDays = [1, 7, 15, 30],
) {
  const supabase = createAdminClient();
  const now = today();
  const todayStr = now.toISOString().split("T")[0];
  const earliestStr = addDays(now, -Math.max(...overdueDays))
    .toISOString()
    .split("T")[0];

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
    .in("status", ["upcoming", "due", "overdue"])
    .lt("due_date", todayStr)
    .gte("due_date", earliestStr);

  if (!payments?.length) return;

  for (const p of payments) {
    const dueDate = new Date(p.due_date);
    const daysLate = daysBetween(dueDate, now);
    if (!overdueDays.includes(daysLate)) continue;

    // Postgrest infers `contract` as an array even for to-one relations;
    // go through `unknown` so TS accepts the narrower union we want.
    const contract = pickOne(
      p.contract as unknown as
        | {
            id: string;
            contract_type: string;
            site:
              | { name: string; site_code: string }
              | { name: string; site_code: string }[]
              | null;
            landowner:
              | { full_name: string }
              | { full_name: string }[]
              | null;
            agency:
              | { agency_name: string }
              | { agency_name: string }[]
              | null;
          }
        | null,
    );
    if (!contract) continue;

    const site = pickOne(contract.site);
    const landowner = pickOne(contract.landowner);
    const agency = pickOne(contract.agency);
    const party =
      contract.contract_type === "landowner"
        ? landowner?.full_name ?? "Landowner"
        : agency?.agency_name ?? "Agency";
    const siteName = site?.name ?? site?.site_code ?? "site";
    const amountLabel = inr(p.amount_paise);
    const severity: Severity = daysLate >= 15 ? "critical" : "warning";

    await safeNotify({
      organizationId: orgId,
      eventType: "payment_overdue",
      entityType: "contract_payment",
      entityId: p.id,
      severity,
      title: `Payment overdue by ${daysLate} day${daysLate !== 1 ? "s" : ""} — ${amountLabel}`,
      message: `${amountLabel} to ${party} for ${siteName} was due ${fmtDate(p.due_date)} (${daysLate} days ago).`,
      data: {
        Counterparty: party,
        Site: siteName,
        Amount: amountLabel,
        "Due date": fmtDate(p.due_date),
        "Days overdue": daysLate,
      },
    });
  }
}

// ─── 3. Invoice Overdue (client side) ──────────────────────────────────────────

async function generateInvoiceOverdueAlerts(
  orgId: string,
  overdueDays = [1, 7, 15, 30],
) {
  const supabase = createAdminClient();
  const now = today();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, due_date, total_paise, client:clients(company_name)",
    )
    .eq("organization_id", orgId)
    .in("status", ["sent", "partially_paid"])
    .lt("due_date", now.toISOString().split("T")[0]);

  if (!invoices?.length) return;

  for (const inv of invoices) {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = daysBetween(dueDate, now);
    if (!overdueDays.includes(daysOverdue)) continue;

    const client = pickOne(
      inv.client as { company_name: string } | { company_name: string }[] | null,
    );
    const amountLabel = inr(inv.total_paise);
    const severity: Severity =
      daysOverdue >= 15 ? "critical" : daysOverdue >= 7 ? "warning" : "info";

    await safeNotify({
      organizationId: orgId,
      eventType: "invoice_overdue",
      entityType: "invoice",
      entityId: inv.id,
      severity,
      title: `Invoice overdue by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}`,
      message: `Invoice ${inv.invoice_number} (${amountLabel}) from ${client?.company_name ?? "Client"} is ${daysOverdue} days past due.`,
      data: {
        "Invoice #": inv.invoice_number ?? "—",
        Client: client?.company_name ?? "—",
        Amount: amountLabel,
        "Due date": fmtDate(inv.due_date),
        "Days overdue": daysOverdue,
      },
    });
  }
}

// ─── 4. Contract Renewal Approaching ──────────────────────────────────────────

async function generateContractRenewalAlerts(
  orgId: string,
  advanceDays = [90, 60, 30],
) {
  const supabase = createAdminClient();
  const now = today();
  const maxDays = Math.max(...advanceDays);

  const { data: contracts } = await supabase
    .from("contracts")
    .select(`
      id, end_date, renewal_date, contract_type,
      site:sites(name, site_code),
      landowner:landowners(full_name),
      agency:partner_agencies(agency_name)
    `)
    .eq("organization_id", orgId)
    .eq("status", "active")
    .lte("end_date", addDays(now, maxDays).toISOString().split("T")[0])
    .gte("end_date", now.toISOString().split("T")[0]);

  if (!contracts?.length) return;

  for (const c of contracts) {
    const endDate = new Date(c.end_date);
    const daysUntil = daysBetween(now, endDate);
    if (!advanceDays.includes(daysUntil)) continue;

    const site = pickOne(
      c.site as { name: string; site_code: string } | { name: string; site_code: string }[] | null,
    );
    const landowner = pickOne(
      c.landowner as { full_name: string } | { full_name: string }[] | null,
    );
    const agency = pickOne(
      c.agency as { agency_name: string } | { agency_name: string }[] | null,
    );
    const party =
      c.contract_type === "landowner"
        ? landowner?.full_name ?? "Landowner"
        : agency?.agency_name ?? "Agency";
    const siteName = site?.name ?? site?.site_code ?? "site";

    await safeNotify({
      organizationId: orgId,
      eventType: "contract_renewal",
      entityType: "contract",
      entityId: c.id,
      severity: severityForCountdown(daysUntil),
      title: `Contract expires in ${daysUntil} days`,
      message: `Contract for ${siteName} with ${party} expires on ${fmtDate(c.end_date)}.`,
      data: {
        Site: siteName,
        Counterparty: party,
        "End date": fmtDate(c.end_date),
        "Days until expiry": daysUntil,
      },
    });
  }
}

// ─── 5. Campaign Starting Today ───────────────────────────────────────────────
// New generator. Fires once on each campaign's start_date so ops/account
// teams know it's gone live. Owner exec is the campaign creator.

async function generateCampaignStartingAlerts(orgId: string) {
  const supabase = createAdminClient();
  const now = today();
  const todayStr = now.toISOString().split("T")[0];

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(
      "id, campaign_name, campaign_code, start_date, end_date, client:clients(company_name)",
    )
    .eq("organization_id", orgId)
    .eq("status", "live")
    .eq("start_date", todayStr)
    .is("deleted_at", null);

  if (!campaigns?.length) return;

  for (const camp of campaigns) {
    const client = pickOne(
      camp.client as { company_name: string } | { company_name: string }[] | null,
    );

    await safeNotify({
      organizationId: orgId,
      eventType: "campaign_starting",
      entityType: "campaign",
      entityId: camp.id,
      severity: "info",
      title: `Campaign starting today — ${camp.campaign_name}`,
      message: `"${camp.campaign_name}"${client ? ` for ${client.company_name}` : ""} starts today. Sites should already be mounted.`,
      data: {
        Campaign: camp.campaign_name,
        Code: camp.campaign_code ?? "—",
        Client: client?.company_name ?? "—",
        "Start date": fmtDate(camp.start_date),
        "End date": fmtDate(camp.end_date),
      },
    });
  }
}

// ─── 6. Campaign Ending Soon ───────────────────────────────────────────────────

async function generateCampaignEndingAlerts(orgId: string, advanceDays = [30, 15, 7, 3]) {
  const supabase = createAdminClient();
  const now = today();
  const maxDays = Math.max(...advanceDays);

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(
      "id, campaign_name, campaign_code, end_date, start_date, client:clients(company_name)",
    )
    .eq("organization_id", orgId)
    .eq("status", "live")
    .lte("end_date", addDays(now, maxDays).toISOString().split("T")[0])
    .gte("end_date", now.toISOString().split("T")[0]);

  if (!campaigns?.length) return;

  for (const camp of campaigns) {
    const endDate = new Date(camp.end_date);
    const daysUntil = daysBetween(now, endDate);
    if (!advanceDays.includes(daysUntil)) continue;

    const client = pickOne(
      camp.client as { company_name: string } | { company_name: string }[] | null,
    );

    await safeNotify({
      organizationId: orgId,
      eventType: "campaign_ending",
      entityType: "campaign",
      entityId: camp.id,
      severity: severityForCountdown(daysUntil),
      title: `Campaign ending in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`,
      message: `"${camp.campaign_name}"${client ? ` for ${client.company_name}` : ""} ends on ${fmtDate(camp.end_date)}.`,
      data: {
        Campaign: camp.campaign_name,
        Code: camp.campaign_code ?? "—",
        Client: client?.company_name ?? "—",
        "End date": fmtDate(camp.end_date),
        "Days remaining": daysUntil,
      },
    });
  }
}

// ─── 7. Municipal Permission Expiry ───────────────────────────────────────────

async function generateMunicipalExpiryAlerts(orgId: string, advanceDays = [60, 30]) {
  const supabase = createAdminClient();
  const now = today();
  const maxDays = Math.max(...advanceDays);

  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, site_code, municipal_permission_expiry")
    .eq("organization_id", orgId)
    .not("municipal_permission_expiry", "is", null)
    .lte(
      "municipal_permission_expiry",
      addDays(now, maxDays).toISOString().split("T")[0],
    )
    .gte("municipal_permission_expiry", now.toISOString().split("T")[0]);

  if (!sites?.length) return;

  for (const site of sites) {
    if (!site.municipal_permission_expiry) continue;
    const expiryDate = new Date(site.municipal_permission_expiry);
    const daysUntil = daysBetween(now, expiryDate);
    if (!advanceDays.includes(daysUntil)) continue;

    const severity: Severity = daysUntil <= 30 ? "critical" : "warning";

    await safeNotify({
      organizationId: orgId,
      eventType: "municipal_expiry",
      entityType: "site",
      entityId: site.id,
      severity,
      title: `Municipal permit expiring in ${daysUntil} days`,
      message: `Site ${site.site_code ?? site.name} municipal permission expires on ${fmtDate(site.municipal_permission_expiry)}.`,
      data: {
        Site: site.name,
        "Site code": site.site_code ?? "—",
        "Expiry date": fmtDate(site.municipal_permission_expiry),
        "Days until expiry": daysUntil,
      },
    });
  }
}

// ─── 8. Mounting Scheduled Tomorrow ───────────────────────────────────────────

async function generateMountingAlerts(orgId: string) {
  const supabase = createAdminClient();
  const tomorrow = addDays(today(), 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const { data: campSites } = await supabase
    .from("campaign_sites")
    .select(`
      id, mounting_date,
      site:sites(name, site_code),
      campaign:campaigns(id, campaign_name, client:clients(company_name))
    `)
    .eq("organization_id", orgId)
    .eq("mounting_date", tomorrowStr);

  if (!campSites?.length) return;

  for (const cs of campSites) {
    const csTyped = cs as unknown as {
      id: string;
      mounting_date: string;
      site:
        | { name: string; site_code: string }
        | { name: string; site_code: string }[]
        | null;
      campaign:
        | {
            id: string;
            campaign_name: string;
            client:
              | { company_name: string }
              | { company_name: string }[]
              | null;
          }
        | {
            id: string;
            campaign_name: string;
            client:
              | { company_name: string }
              | { company_name: string }[]
              | null;
          }[]
        | null;
    };
    const site = pickOne(csTyped.site);
    const campaign = pickOne(csTyped.campaign);
    const client = campaign ? pickOne(campaign.client) : null;
    const siteName = site?.name ?? site?.site_code ?? "site";
    const campaignName = campaign?.campaign_name ?? "campaign";

    // Anchor the dedup on the campaign_site row id so two campaigns
    // mounting the same site on the same day don't collide.
    await safeNotify({
      organizationId: orgId,
      eventType: "mounting_scheduled",
      entityType: "campaign",
      entityId: csTyped.id,
      severity: "info",
      title: `Mounting scheduled for tomorrow — ${siteName}`,
      message: `Mounting at ${siteName} for "${campaignName}"${client ? ` (${client.company_name})` : ""} is scheduled for ${fmtDate(csTyped.mounting_date)}.`,
      data: {
        Site: siteName,
        Campaign: campaignName,
        Client: client?.company_name ?? "—",
        "Mounting date": fmtDate(csTyped.mounting_date),
      },
      // Take the user to the campaign — that's where the field team
      // checks for creatives and mounting notes.
      link: campaign ? `/campaigns/${campaign.id}` : undefined,
    });
  }
}

// ─── 9. cron_failure self-care ────────────────────────────────────────────────
// Called from the cron route's top-level catch. The dispatcher knows
// which admins want the email, so we don't have to hard-code addresses.

export async function notifyCronFailure(
  orgId: string,
  cronName: string,
  errorMessage: string,
) {
  await safeNotify({
    organizationId: orgId,
    eventType: "cron_failure",
    severity: "critical",
    title: `Cron job failed — ${cronName}`,
    message: `The ${cronName} cron job failed on ${fmtDate(new Date().toISOString())}: ${errorMessage}`,
    data: {
      "Cron job": cronName,
      Error: errorMessage,
      Time: new Date().toISOString(),
    },
  });
}

// Generator descriptor — lets us list / iterate without a giant switch.
const GENERATORS: Array<{
  name: NotificationEvent;
  run: (orgId: string) => Promise<void>;
}> = [
  { name: "payment_due", run: generatePaymentDueAlerts },
  { name: "payment_overdue", run: generatePaymentOverdueAlerts },
  { name: "invoice_overdue", run: generateInvoiceOverdueAlerts },
  { name: "contract_renewal", run: generateContractRenewalAlerts },
  { name: "campaign_starting", run: generateCampaignStartingAlerts },
  { name: "campaign_ending", run: generateCampaignEndingAlerts },
  { name: "municipal_expiry", run: generateMunicipalExpiryAlerts },
  { name: "mounting_scheduled", run: generateMountingAlerts },
];

// ─── MAIN EXPORTS ────────────────────────────────────────────────────────────

export async function generateAlertsForOrg(orgId: string): Promise<void> {
  // Run sequentially. Parallelising helps very little in practice (each
  // generator has at most a handful of rows) and makes log output much
  // harder to read when something breaks. Sequential is the right tradeoff
  // for daily cron runs.
  for (const gen of GENERATORS) {
    try {
      await gen.run(orgId);
    } catch (err) {
      console.warn(`[alerts] ${gen.name} failed for org ${orgId}:`, err);
    }
  }
}

export async function generateAlertsForAllOrgs(): Promise<{
  processed: number;
  errors: string[];
}> {
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
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Org ${org.name}: ${msg}`);
      // Fire a self-care notification so admins of THIS org learn
      // their cron run failed. If notify() also throws, swallow it.
      await notifyCronFailure(org.id, "generate-alerts", msg);
    }
  }

  return { processed, errors };
}
