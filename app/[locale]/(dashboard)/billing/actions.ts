"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceStatus, PaymentMode } from "@/lib/types/database";
import { notify } from "@/lib/notifications/dispatch";
import { inr } from "@/lib/utils";
import { invoiceSchema } from "@/lib/validations/invoice";
import {
  paymentReceivedSchema,
  balanceAfterReceipt,
} from "@/lib/validations/payment-received";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrgAndUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("org_id").eq("id", user.id).single();
  if (!profile?.org_id) return null;
  return { supabase, user, orgId: profile.org_id };
}

function str(v?: string | null) { return v?.trim() || null; }
function n(v: number | undefined | null) { return v != null ? Math.round(v * 100) : 0; }

// Receipt number generator: MKACS-RCP-YYYYMM-NNNN (migration 038
// adopted MKACS- as the org-wide prefix on every sequential code).
// The count() scope includes BOTH the new prefix and the legacy
// RCP-… prefix for the same month so the sequence stays monotonic
// across the prefix switch.
async function generateReceiptNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  date: string,
): Promise<string> {
  const ym = date.slice(0, 7).replace("-", "");
  const { count } = await supabase
    .from("payments_received")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .or(
      `receipt_number.ilike.MKACS-RCP-${ym}-%,receipt_number.ilike.RCP-${ym}-%`,
    );
  const seq = (count ?? 0) + 1;
  return `MKACS-RCP-${ym}-${String(seq).padStart(4, "0")}`;
}

// Invoice line-item and whole-invoice schemas live in
// lib/validations/invoice.ts so a lightweight node --test suite can
// import them without pulling the Next.js server runtime. See the
// JSDoc there for the rationale (bugs #1-#2 of the Nov 2026 batch).


// ─── Create Invoice ───────────────────────────────────────────────────────────

export async function createInvoice(values: unknown): Promise<{ error: string } | { id: string }> {
  try {
    const parsed = invoiceSchema.safeParse(values);
    if (!parsed.success) {
      // Surface the FAILING FIELD NAME so "Invalid input: expected
      // string, received null" is actually traceable. Previously the
      // toast only showed the raw message and the user had to guess
      // which field was wrong (bug reports kept landing with no clue).
      const issue = parsed.error.issues[0];
      const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return { error: path + issue.message };
    }

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    // Build the insert payload. Try with migration-047 columns first;
    // if they don't exist yet, retry without them so the create keeps
    // working for users who haven't applied 047. Agency bill-to needs
    // 047 and is rejected below when it isn't available.
    const basePayload = {
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
      client_id:  d.bill_to_type === "client" ? d.client_id ?? null : null,
      campaign_id: d.campaign_id ?? null,
      invoice_date: d.invoice_date,
      due_date: d.due_date,
      subtotal_paise: n(d.subtotal_inr),
      cgst_paise: n(d.cgst_inr),
      sgst_paise: n(d.sgst_inr),
      igst_paise: n(d.igst_inr),
      total_paise: n(d.total_inr),
      balance_due_paise: n(d.total_inr),
      supplier_gstin: str(d.supplier_gstin),
      buyer_gstin: str(d.buyer_gstin),
      place_of_supply_state: str(d.place_of_supply_state),
      is_inter_state: d.is_inter_state,
      bank_account_id: d.bank_account_id ?? null,
      status: d.status,
      notes: str(d.notes),
      terms_and_conditions: str(d.terms_and_conditions),
    };
    const withNewCols = {
      ...basePayload,
      bill_to_type: d.bill_to_type,
      billed_agency_id: d.bill_to_type === "agency" ? d.billed_agency_id ?? null : null,
      external_invoice_number: str(d.external_invoice_number),
    };

    let inv: { id: string } | null = null;
    let invErr: { message: string } | null = null;
    {
      const res = await ctx.supabase
        .from("invoices")
        .insert(withNewCols)
        .select("id")
        .single();
      inv = res.data;
      invErr = res.error;
    }
    // Retry once without the 047-only columns if the DB rejected them.
    // The error shape from Postgrest / PGRST204 matches this message.
    if (invErr && /Could not find the .* column/i.test(invErr.message)) {
      if (d.bill_to_type === "agency") {
        return {
          error:
            "Agency billing needs migration 047 applied. Run supabase/migrations/047_invoice_bill_to_agency_and_multi_campaign.sql first.",
        };
      }
      const res = await ctx.supabase
        .from("invoices")
        .insert(basePayload)
        .select("id")
        .single();
      inv = res.data;
      invErr = res.error;
    }

    if (invErr || !inv) return { error: invErr?.message ?? "Failed to create invoice" };

    // Insert line items. Each line can carry its own campaign_id so one
    // invoice can span several campaigns. When migration 047 hasn't
    // been applied, invoice_line_items.campaign_id doesn't exist — we
    // retry without it on that one specific error.
    const invoiceId = inv.id;
    const lineItemsBase = d.line_items.map((li) => ({
      organization_id: ctx.orgId,
      invoice_id: invoiceId,
      site_id: li.site_id ?? null,
      service_type: li.service_type,
      description: li.description,
      hsn_sac_code: li.hsn_sac_code || "998361",
      quantity: li.quantity,
      rate_paise: Math.round(li.rate_inr * 100),
      amount_paise: Math.round(li.rate_inr * li.quantity * 100),
      period_from: str(li.period_from),
      period_to: str(li.period_to),
    }));
    const lineItemsWithCampaign = d.line_items.map((li, i) => ({
      ...lineItemsBase[i],
      campaign_id: li.campaign_id ?? d.campaign_id ?? null,
    }));

    let liErr = (await ctx.supabase.from("invoice_line_items").insert(lineItemsWithCampaign)).error;
    if (liErr && /Could not find the .* column/i.test(liErr.message)) {
      liErr = (await ctx.supabase.from("invoice_line_items").insert(lineItemsBase)).error;
    }
    if (liErr) return { error: liErr.message };

    revalidatePath("/billing/invoices");
    revalidatePath("/billing/receivables");
    return { id: inv.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createInvoice");
  }
}

// ─── Update Invoice ───────────────────────────────────────────────────────────

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Fetch current status + details we need for the notification body.
    // The client join here gives us the company name in one round-trip
    // so we don't have to refetch after the status flip.
    const { data: invoiceRaw } = await ctx.supabase
      .from("invoices")
      .select(
        "status, invoice_number, total_paise, due_date, client:clients(company_name)",
      )
      .eq("id", id)
      .single();

    if (!invoiceRaw) return { error: "Invoice not found" };

    // Postgrest's embedded-relation typing widens `client` to either
    // a single object OR an array. Cast and normalise so downstream
    // reads are predictable.
    const invoice = invoiceRaw as unknown as {
      status: string;
      invoice_number: string | null;
      total_paise: number | null;
      due_date: string | null;
      client: { company_name: string | null } | { company_name: string | null }[] | null;
    };

    // Only allow valid status transitions
    const ALLOWED_TRANSITIONS: Record<string, string[]> = {
      draft: ["sent", "cancelled"],
      sent: ["partially_paid", "paid", "overdue", "cancelled"],
      partially_paid: ["paid", "overdue", "cancelled"],
      overdue: ["partially_paid", "paid", "cancelled"],
      paid: [],       // terminal state
      cancelled: [],  // terminal state
    };

    const allowed = ALLOWED_TRANSITIONS[invoice.status] ?? [];
    if (!allowed.includes(status)) {
      return { error: `Cannot change status from "${invoice.status}" to "${status}"` };
    }

    const { error } = await ctx.supabase
      .from("invoices")
      .update({ status, updated_by: ctx.user.id })
      .eq("id", id);

    if (error) return { error: error.message };
    revalidatePath("/billing/invoices");
    revalidatePath(`/billing/invoices/${id}`);

    // Tell the team that the invoice is officially "out the door". We
    // only fire for draft → sent — other transitions (sent → paid etc.)
    // have their own notifications elsewhere.
    if (status === "sent") {
      const clientName = Array.isArray(invoice.client)
        ? invoice.client[0]?.company_name ?? null
        : invoice.client?.company_name ?? null;
      const amountLabel = inr(invoice.total_paise);
      await notify({
        organizationId: ctx.orgId,
        eventType: "invoice_sent",
        entityType: "invoice",
        entityId: id,
        severity: "info",
        title: `Invoice sent — ${invoice.invoice_number ?? id}`,
        message: `${invoice.invoice_number ?? "Invoice"} for ${amountLabel} was sent to ${clientName ?? "—"}.`,
        data: {
          "Invoice #": invoice.invoice_number ?? "—",
          Client: clientName ?? "—",
          Amount: amountLabel,
          "Due date": invoice.due_date ?? "—",
        },
      });
    }

    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateInvoiceStatus");
  }
}

// ─── Delete Invoice (soft) ────────────────────────────────────────────────────

export async function deleteInvoice(id: string): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const { error } = await ctx.supabase.rpc("soft_delete_row", {
      p_table: "invoices",
      p_id: id,
    });
    if (error) return { error: error.message };
    revalidatePath("/billing/invoices");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteInvoice");
  }
}

// ─── Record Payment ───────────────────────────────────────────────────────────

export async function recordPayment(
  invoiceId: string,
  values: unknown
): Promise<{ error?: string }> {
  try {
    const parsed = paymentReceivedSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return { error: path + issue.message };
    }

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    // Fetch the invoice and read its bill-to side. The payer is either
    // the direct client or the billed agency (migration 047); we set
    // the matching column on payments_received so the agency-billed
    // case doesn't fail the client_id NOT-NULL from migration 048.
    //
    // billed_agency_id / bill_to_type are 047 columns; wrap in a retry
    // without them so Record Payment keeps working on databases where
    // 047 hasn't been applied yet (the fallback path treats every
    // invoice as client-billed, which is the pre-047 behaviour).
    type InvoiceForReceipt = {
      client_id: string | null;
      billed_agency_id?: string | null;
      bill_to_type?: "client" | "agency";
      total_paise: number | null;
      amount_paid_paise: number | null;
      balance_due_paise: number | null;
      invoice_number: string;
      client: { company_name: string | null } | { company_name: string | null }[] | null;
      agency: { agency_name: string | null } | { agency_name: string | null }[] | null;
    };

    let invoice: InvoiceForReceipt | null = null;
    {
      const { data, error } = await ctx.supabase
        .from("invoices")
        .select(
          "client_id, billed_agency_id, bill_to_type, total_paise, amount_paid_paise, balance_due_paise, invoice_number, " +
            "client:clients(company_name)",
        )
        .eq("id", invoiceId)
        .maybeSingle();
      if (error && /Could not find the .* column/i.test(error.message)) {
        const retry = await ctx.supabase
          .from("invoices")
          .select(
            "client_id, total_paise, amount_paid_paise, balance_due_paise, invoice_number, " +
              "client:clients(company_name)",
          )
          .eq("id", invoiceId)
          .maybeSingle();
        invoice = retry.data as unknown as InvoiceForReceipt | null;
        if (invoice) {
          invoice.billed_agency_id = null;
          invoice.bill_to_type = "client";
          invoice.agency = null;
        }
      } else {
        invoice = data as unknown as InvoiceForReceipt | null;
      }
    }

    if (!invoice) return { error: "Invoice not found" };

    // Hydrate the agency row for the notification payload — second
    // query so this keeps working on pre-047 databases. Non-fatal
    // either way; the notify() call below just loses the payer name.
    if (invoice.billed_agency_id) {
      const { data: agencyRow } = await ctx.supabase
        .from("partner_agencies")
        .select("agency_name")
        .eq("id", invoice.billed_agency_id)
        .maybeSingle();
      invoice.agency = agencyRow ?? null;
    }

    const isAgencyBill =
      invoice.bill_to_type === "agency" && !!invoice.billed_agency_id;

    const amountPaise = Math.round(d.amount_inr * 100);
    const tdsPaise = Math.round((d.tds_inr ?? 0) * 100);
    // Balance = total - sum(amount + tds). Use the stored
    // balance_due_paise which is the running tally after every prior
    // receipt + allocation on this invoice.
    const balanceDuePaise =
      invoice.balance_due_paise ??
      (invoice.total_paise ?? 0) - (invoice.amount_paid_paise ?? 0);
    const effectivePaise = amountPaise + tdsPaise;

    // Prevent overpayment — effective (cash + TDS) can't exceed the
    // remaining balance. Rounding tolerance of 1 paisa so a receipt
    // that settles the invoice to within one paisa doesn't get
    // rejected (same tolerance balanceAfterReceipt uses to flip the
    // status to "paid").
    if (effectivePaise > balanceDuePaise + 1) {
      return { error: "Amount + TDS exceeds balance due" };
    }

    const projected = balanceAfterReceipt({
      totalPaise: invoice.total_paise ?? 0,
      previousBalancePaise: balanceDuePaise,
      previousAmountPaidPaise: invoice.amount_paid_paise ?? 0,
      amountPaise,
      tdsPaise,
    });

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber(ctx.supabase, ctx.orgId, d.payment_date);

    // Insert payment record. Try with the 048 columns first (agency
    // payer + TDS); if the DB hasn't applied 048 yet, retry without
    // those and reject the agency-bill case with a clear error so we
    // never silently drop TDS or mis-attribute an agency receipt to a
    // NULL client_id.
    const basePayload = {
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      invoice_id: invoiceId,
      amount_paise: amountPaise,
      payment_date: d.payment_date,
      payment_mode: d.payment_mode as PaymentMode,
      reference_number: str(d.reference_number),
      bank_name: str(d.bank_name),
      notes: str(d.notes),
      receipt_number: receiptNumber,
    };
    const withNewCols = {
      ...basePayload,
      // Mirror the invoice's bill-to side on the receipt (048).
      client_id: isAgencyBill ? null : invoice.client_id,
      agency_id: isAgencyBill ? invoice.billed_agency_id : null,
      tds_paise: tdsPaise,
    };

    let payErr: { message: string } | null = null;
    {
      const res = await ctx.supabase.from("payments_received").insert(withNewCols);
      if (res.error && /Could not find the .* column/i.test(res.error.message)) {
        if (isAgencyBill) {
          return {
            error:
              "Agency-billed receipts need migration 048 to be applied. Run it from the Supabase SQL editor and try again.",
          };
        }
        if (tdsPaise > 0) {
          return {
            error:
              "Recording TDS needs migration 048 to be applied. Run it from the Supabase SQL editor and try again.",
          };
        }
        const retry = await ctx.supabase
          .from("payments_received")
          .insert({ ...basePayload, client_id: invoice.client_id });
        payErr = retry.error ? { message: retry.error.message } : null;
      } else {
        payErr = res.error ? { message: res.error.message } : null;
      }
    }
    if (payErr) return { error: payErr.message };

    // Update invoice totals and status
    const { error: updErr } = await ctx.supabase
      .from("invoices")
      .update({
        amount_paid_paise: projected.newAmountPaidPaise,
        balance_due_paise: projected.newBalancePaise,
        status: projected.newStatus,
        updated_by: ctx.user.id,
      })
      .eq("id", invoiceId);

    if (updErr) return { error: updErr.message };

    // Fan out an invoice_paid notification — accounts + admin get
    // an email by default (see lib/notifications/audience.ts), the
    // owning executive gets an in-app alert. Fire-and-forget; if
    // Resend is down or the dispatcher hiccups the user still gets
    // a successful "payment recorded" response.
    const clientRel = invoice!.client;
    const agencyRel = invoice!.agency;
    const clientName = Array.isArray(clientRel)
      ? clientRel[0]?.company_name ?? null
      : clientRel?.company_name ?? null;
    const agencyName = Array.isArray(agencyRel)
      ? agencyRel[0]?.agency_name ?? null
      : agencyRel?.agency_name ?? null;
    const payerName = isAgencyBill ? agencyName : clientName;
    const amountFormatted = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amountPaise / 100);
    const isFullSettlement = projected.newStatus === "paid";
    const payerLabel = isAgencyBill ? "Agency" : "Client";
    await notify({
      organizationId: ctx.orgId,
      eventType: "invoice_paid",
      entityType: "invoice",
      entityId: invoiceId,
      severity: "info",
      title: isFullSettlement
        ? `Payment received — ${invoice.invoice_number} settled`
        : `Partial payment received — ${invoice.invoice_number}`,
      message: isFullSettlement
        ? `${payerName ?? payerLabel} paid ${amountFormatted} against invoice ${invoice.invoice_number}. The invoice is now fully settled.`
        : `${payerName ?? payerLabel} paid ${amountFormatted} against invoice ${invoice.invoice_number}. Balance remaining will appear on the invoice.`,
      data: {
        Invoice: invoice.invoice_number,
        [payerLabel]: payerName ?? "—",
        Amount: amountFormatted,
        Mode: d.payment_mode,
        "Receipt #": receiptNumber,
      },
    });

    revalidatePath("/billing/invoices");
    revalidatePath(`/billing/invoices/${invoiceId}`);
    revalidatePath("/billing/receivables");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "recordPayment");
  }
}

// ─── Get campaign line items (for pre-populating invoice form) ─────────────────
//
// Returns a line-item array sized to a BILLING PERIOD. If periodFrom /
// periodTo are given, each per-month site becomes a line billed
// pro-rata (`quantity = days`, `rate_inr = monthly_rate / 30`), so a
// line's amount is `days × daily_rate` — the standard "N days @ ₹X/day"
// invoice format Indian clients expect. Without a period, each site's
// own date range is used.
//
// Services (printing / mounting / design / transport / other) are
// always billed as stored — those are flat charges, not pro-rated.

export async function getCampaignLineItems(
  campaignId: string,
  periodFrom?: string,
  periodTo?: string,
) {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { items: [], campaignValue: 0, pricingType: "itemized" as const };

    const { data: campaign } = await ctx.supabase
      .from("campaigns")
      .select("pricing_type, total_value_paise, campaign_name, start_date, end_date")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { items: [], campaignValue: 0, pricingType: "itemized" as const };

    if (campaign.pricing_type === "bundled") {
      return {
        items: [{
          service_type: "display_rental" as const,
          description: `Campaign: ${campaign.campaign_name}`,
          hsn_sac_code: "998361",
          quantity: 1,
          rate_inr: (campaign.total_value_paise ?? 0) / 100,
          period_from: periodFrom,
          period_to: periodTo,
          site_id: undefined,
        }],
        campaignValue: campaign.total_value_paise ?? 0,
        pricingType: "bundled" as const,
      };
    }

    // Itemized: pull both the per-site rental data AND the services. The
    // site rental lines are new in this flow (previously only services
    // showed up on invoices generated from a campaign, so the display
    // rent lived outside the invoice entirely).
    const [{ data: campSites }, { data: services }] = await Promise.all([
      ctx.supabase
        .from("campaign_sites")
        .select(`
          id, display_rate_paise, rate_type, start_date, end_date,
          site:sites(id, name, site_code)
        `)
        .eq("campaign_id", campaignId),
      ctx.supabase
        .from("campaign_services")
        .select("service_type, description, quantity, rate_paise, total_paise, site_id")
        .eq("campaign_id", campaignId),
    ]);

    type SiteJoin =
      | { id: string; name: string | null; site_code: string | null }
      | { id: string; name: string | null; site_code: string | null }[]
      | null;
    type CampSiteRow = {
      id: string;
      display_rate_paise: number | null;
      rate_type: string | null;
      start_date: string | null;
      end_date: string | null;
      site: SiteJoin;
    };

    const pickSite = (s: SiteJoin) =>
      Array.isArray(s) ? s[0] ?? null : s;

    // Build per-site display rental lines. Each site's billable range is
    // the INTERSECTION of (periodFrom..periodTo) and (site.start..site.end)
    // so a site that was only live for part of the chosen window gets
    // billed proportionally — the default most accounts teams want.
    const siteLines = ((campSites ?? []) as CampSiteRow[])
      .map((cs) => {
        const monthlyPaise = cs.display_rate_paise ?? 0;
        if (!monthlyPaise || !cs.start_date || !cs.end_date) return null;
        const siteInfo = pickSite(cs.site);
        if (!siteInfo) return null;

        const fromStr = periodFrom && periodFrom > cs.start_date
          ? periodFrom
          : cs.start_date;
        const toStr = periodTo && periodTo < cs.end_date
          ? periodTo
          : cs.end_date;
        if (toStr < fromStr) return null; // site not in this window

        const days = daysInclusive(fromStr, toStr);
        if (days <= 0) return null;

        // Daily rate (so the invoice line reads "N days @ ₹Y/day"). We
        // divide at the DISPLAY level — keeping two decimals is enough
        // since the amount is derived from paise upstream.
        const dailyRateInr = (monthlyPaise / 30) / 100;
        const siteName = siteInfo.name ?? siteInfo.site_code ?? "Site";
        const code = siteInfo.site_code ? ` (${siteInfo.site_code})` : "";

        return {
          service_type: "display_rental" as const,
          description: `Display Rental — ${siteName}${code} — ${fromStr} to ${toStr}`,
          hsn_sac_code: "998361",
          quantity: days,
          rate_inr: Math.round(dailyRateInr * 100) / 100,
          period_from: fromStr,
          period_to: toStr,
          site_id: siteInfo.id,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    // Flat services — printing, mounting, design etc. These are
    // one-time charges that fire at campaign start, so a period-scoped
    // invoice (e.g. an extension invoice) should EXCLUDE them: billing
    // the printing charge again when the campaign is extended would
    // double-charge the client. A non-period invoice (plain
    // campaign-linked invoice) still gets them.
    const includeServices = !periodFrom && !periodTo;
    const serviceLines = includeServices
      ? (services ?? []).map((s) => ({
          service_type: s.service_type as "display_rental" | "flex_printing" | "mounting" | "design" | "transport" | "other",
          description: s.description ?? s.service_type,
          hsn_sac_code: "998361",
          quantity: s.quantity ?? 1,
          rate_inr: (s.rate_paise ?? 0) / 100,
          period_from: undefined,
          period_to: undefined,
          site_id: s.site_id ?? undefined,
        }))
      : [];

    const items = [...siteLines, ...serviceLines];
    return { items, campaignValue: 0, pricingType: "itemized" as const };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "getCampaignLineItems");
  }
}

// Days between two YYYY-MM-DD strings, inclusive of both ends. Mirrors
// the pro-rata rule used in lib/campaigns/derive.ts so invoices and the
// campaign total stay numerically consistent.
function daysInclusive(fromStr: string, toStr: string): number {
  const from = new Date(fromStr).getTime();
  const to = new Date(toStr).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1);
}
