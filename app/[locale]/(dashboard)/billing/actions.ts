"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { InvoiceStatus, PaymentMode } from "@/lib/types/database";

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

// Receipt number generator: RCP-YYYYMM-NNNN
async function generateReceiptNumber(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, date: string): Promise<string> {
  const ym = date.slice(0, 7).replace("-", "");
  const { count } = await supabase
    .from("payments_received")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .ilike("receipt_number", `RCP-${ym}-%`);
  const seq = (count ?? 0) + 1;
  return `RCP-${ym}-${String(seq).padStart(4, "0")}`;
}

// ─── Invoice line item schema ─────────────────────────────────────────────────

const lineItemSchema = z.object({
  service_type: z.enum(["display_rental", "flex_printing", "mounting", "design", "transport", "other"]),
  description: z.string().min(1, "Description required"),
  hsn_sac_code: z.string().default("998361"),
  quantity: z.number().positive().default(1),
  rate_inr: z.number().min(0),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
  site_id: z.string().uuid().optional(),
});

// ─── Invoice creation schema ──────────────────────────────────────────────────

const invoiceSchema = z.object({
  client_id: z.string().uuid("Select a client"),
  campaign_id: z.string().uuid().optional(),
  invoice_date: z.string().min(1, "Invoice date required"),
  due_date: z.string().min(1, "Due date required"),
  subtotal_inr: z.number().min(0),
  cgst_inr: z.number().min(0).default(0),
  sgst_inr: z.number().min(0).default(0),
  igst_inr: z.number().min(0).default(0),
  total_inr: z.number().min(0),
  supplier_gstin: z.string().optional(),
  buyer_gstin: z.string().optional(),
  place_of_supply_state: z.string().optional(),
  is_inter_state: z.boolean().default(false),
  bank_account_id: z.string().uuid().optional(),
  notes: z.string().optional(),
  terms_and_conditions: z.string().optional(),
  status: z.enum(["draft", "sent"]).default("draft"),
  line_items: z.array(lineItemSchema).min(1, "Add at least one line item"),
});


// ─── Create Invoice ───────────────────────────────────────────────────────────

export async function createInvoice(values: unknown): Promise<{ error: string } | { id: string }> {
  try {
    const parsed = invoiceSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    const { data: inv, error: invErr } = await ctx.supabase
      .from("invoices")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        client_id: d.client_id,
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
      })
      .select("id")
      .single();

    if (invErr || !inv) return { error: invErr?.message ?? "Failed to create invoice" };

    // Insert line items
    const lineItems = d.line_items.map((li) => ({
      organization_id: ctx.orgId,
      invoice_id: inv.id,
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

    const { error: liErr } = await ctx.supabase.from("invoice_line_items").insert(lineItems);
    if (liErr) return { error: liErr.message };

    revalidatePath("/billing/invoices");
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

    // Fetch current status to validate the transition
    const { data: invoice } = await ctx.supabase
      .from("invoices")
      .select("status")
      .eq("id", id)
      .single();

    if (!invoice) return { error: "Invoice not found" };

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

const recordPaymentSchema = z.object({
  amount_inr: z.number().positive("Amount must be positive"),
  payment_date: z.string().min(1, "Payment date required"),
  payment_mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "online"]),
  reference_number: z.string().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
});

export async function recordPayment(
  invoiceId: string,
  values: unknown
): Promise<{ error?: string }> {
  try {
    const parsed = recordPaymentSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    // Fetch current invoice
    const { data: invoice } = await ctx.supabase
      .from("invoices")
      .select("client_id, total_paise, amount_paid_paise")
      .eq("id", invoiceId)
      .single();

    if (!invoice) return { error: "Invoice not found" };

    const amountPaise = Math.round(d.amount_inr * 100);
    const balanceDuePaise = (invoice.total_paise ?? 0) - (invoice.amount_paid_paise ?? 0);

    // Prevent overpayment — amount cannot exceed the remaining balance
    if (amountPaise > balanceDuePaise) {
      return { error: "Payment amount exceeds balance due" };
    }

    const newAmountPaid = (invoice.amount_paid_paise ?? 0) + amountPaise;
    const newBalance = (invoice.total_paise ?? 0) - newAmountPaid;
    const newStatus: InvoiceStatus = newBalance <= 0 ? "paid" : "partially_paid";

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber(ctx.supabase, ctx.orgId, d.payment_date);

    // Insert payment record
    const { error: payErr } = await ctx.supabase.from("payments_received").insert({
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      invoice_id: invoiceId,
      client_id: invoice.client_id,
      amount_paise: amountPaise,
      payment_date: d.payment_date,
      payment_mode: d.payment_mode as PaymentMode,
      reference_number: str(d.reference_number),
      bank_name: str(d.bank_name),
      notes: str(d.notes),
      receipt_number: receiptNumber,
    });
    if (payErr) return { error: payErr.message };

    // Update invoice totals and status
    const { error: updErr } = await ctx.supabase
      .from("invoices")
      .update({
        amount_paid_paise: newAmountPaid,
        balance_due_paise: Math.max(0, newBalance),
        status: newStatus,
        updated_by: ctx.user.id,
      })
      .eq("id", invoiceId);

    if (updErr) return { error: updErr.message };

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

export async function getCampaignLineItems(campaignId: string) {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { items: [], campaignValue: 0, pricingType: "itemized" as const };

    const { data: campaign } = await ctx.supabase
      .from("campaigns")
      .select("pricing_type, total_value_paise, campaign_name")
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
          period_from: undefined,
          period_to: undefined,
          site_id: undefined,
        }],
        campaignValue: campaign.total_value_paise ?? 0,
        pricingType: "bundled" as const,
      };
    }

    const { data: services } = await ctx.supabase
      .from("campaign_services")
      .select("service_type, description, quantity, rate_paise, total_paise, site_id")
      .eq("campaign_id", campaignId);

    const items = (services ?? []).map((s) => ({
      service_type: s.service_type as "display_rental" | "flex_printing" | "mounting" | "design" | "transport" | "other",
      description: s.description ?? s.service_type,
      hsn_sac_code: "998361",
      quantity: s.quantity ?? 1,
      rate_inr: (s.rate_paise ?? 0) / 100,
      period_from: undefined,
      period_to: undefined,
      site_id: s.site_id ?? undefined,
    }));

    return { items, campaignValue: 0, pricingType: "itemized" as const };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "getCampaignLineItems");
  }
}
