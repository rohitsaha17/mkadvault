"use server";
// Server actions for on-account client receipts.
//
// A "client receipt" captures money arriving from a client without
// being tied to any particular invoice up front. This is the common
// case when a client pays a round amount by NEFT to cover several
// outstanding bills, or sends an advance against future work — the
// accountant posts the receipt now and allocates it against invoices
// later.
//
// Two tables back this:
//   * client_receipts — the top-level receipt row (amount, date, mode).
//   * client_receipt_allocations — one row per invoice the receipt is
//     applied against. Sum of allocations.amount_paise must never
//     exceed the parent receipt's amount_paise. Unallocated balance
//     surfaces on the client receipts list so finance can see what's
//     still "sitting on account".

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  clientReceiptSchema,
  clientReceiptAllocationSchema,
} from "@/lib/validations/client-receipt";
import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";

async function getOrgAndUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) return null;
  return { supabase, user, orgId: profile.org_id };
}

function str(v?: string | null) {
  return v?.trim() || null;
}

function toPaise(inr: number) {
  // Rounding away from zero so a user typing 100.55 doesn't lose 0.5 paise
  // and a user typing 100.549 doesn't accidentally round up to 100.55.
  return Math.round(inr * 100);
}

function revalidateBilling() {
  // Same "page" invalidation as the finance side so filter/pagination
  // variants of the list also refresh after a mutation.
  revalidatePath("/billing", "page");
  revalidatePath("/billing/receipts", "page");
  revalidatePath("/billing/client-receipts", "page");
  revalidatePath("/billing/aging", "page");
  revalidatePath("/billing/receivables", "page");
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createClientReceipt(
  values: unknown,
): Promise<{ error: string } | { id: string }> {
  try {
    const parsed = clientReceiptSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const { data: receipt, error } = await ctx.supabase
      .from("client_receipts")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        client_id: d.client_id,
        receipt_number: str(d.receipt_number),
        receipt_date: d.receipt_date,
        amount_paise: toPaise(d.amount_inr),
        payment_mode: d.payment_mode,
        reference_number: str(d.reference_number),
        bank_name: str(d.bank_name),
        tds_paise: toPaise(d.tds_inr),
        external_reference: str(d.external_reference),
        notes: str(d.notes),
      })
      .select("id")
      .single();

    if (error || !receipt) return { error: error?.message ?? "Failed to record receipt" };

    revalidateBilling();
    return { id: receipt.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createClientReceipt");
  }
}

// ─── Allocate ────────────────────────────────────────────────────────────────
// Links a slice of a client receipt to a specific invoice and bumps
// invoices.amount_paid_paise / balance_due_paise / status in the same
// shot so the two sides stay consistent. Multiple allocations per
// receipt supported — this just adds one at a time.

export async function allocateClientReceiptToInvoice(
  values: unknown,
): Promise<{ error?: string; allocationId?: string }> {
  try {
    const parsed = clientReceiptAllocationSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const amountPaise = toPaise(d.amount_inr);

    // Fetch receipt + prior allocations to validate we're not over-allocating.
    const [receiptRes, allocationsRes, invoiceRes] = await Promise.all([
      ctx.supabase
        .from("client_receipts")
        .select("id, amount_paise, client_id")
        .eq("id", d.client_receipt_id)
        .is("deleted_at", null)
        .single(),
      ctx.supabase
        .from("client_receipt_allocations")
        .select("amount_paise")
        .eq("client_receipt_id", d.client_receipt_id),
      ctx.supabase
        .from("invoices")
        .select("id, client_id, amount_paid_paise, total_paise, balance_due_paise")
        .eq("id", d.invoice_id)
        .is("deleted_at", null)
        .single(),
    ]);

    if (receiptRes.error || !receiptRes.data) return { error: "Receipt not found" };
    if (invoiceRes.error || !invoiceRes.data) return { error: "Invoice not found" };

    if (receiptRes.data.client_id !== invoiceRes.data.client_id) {
      return { error: "Receipt and invoice belong to different clients" };
    }

    const alreadyAllocated = (allocationsRes.data ?? []).reduce(
      (s, a) => s + (a.amount_paise ?? 0),
      0,
    );
    const receiptBalance = receiptRes.data.amount_paise - alreadyAllocated;
    if (amountPaise > receiptBalance) {
      return {
        error: `Only ₹${(receiptBalance / 100).toFixed(2)} of this receipt is still unallocated`,
      };
    }
    if (amountPaise > invoiceRes.data.balance_due_paise) {
      return {
        error: `Invoice only has ₹${(invoiceRes.data.balance_due_paise / 100).toFixed(2)} outstanding`,
      };
    }

    const { data: allocation, error: allocErr } = await ctx.supabase
      .from("client_receipt_allocations")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        client_receipt_id: d.client_receipt_id,
        invoice_id: d.invoice_id,
        amount_paise: amountPaise,
        notes: str(d.notes),
      })
      .select("id")
      .single();

    if (allocErr || !allocation) return { error: allocErr?.message ?? "Failed to allocate" };

    // Bump the invoice: paid += amount, balance -= amount. Status moves
    // to partially_paid or paid depending on whether balance hits 0.
    const newPaid = (invoiceRes.data.amount_paid_paise ?? 0) + amountPaise;
    const newBalance = (invoiceRes.data.balance_due_paise ?? 0) - amountPaise;
    const newStatus = newBalance <= 0 ? "paid" : "partially_paid";

    const { error: invErr } = await ctx.supabase
      .from("invoices")
      .update({
        amount_paid_paise: newPaid,
        balance_due_paise: Math.max(0, newBalance),
        status: newStatus,
      })
      .eq("id", d.invoice_id);

    if (invErr) return { error: invErr.message };

    revalidateBilling();
    return { allocationId: allocation.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "allocateClientReceiptToInvoice");
  }
}
