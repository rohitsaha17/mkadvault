"use server";
// Server actions for site_expenses — create a payment request, move through
// the lifecycle (pending → approved → paid / rejected), upload supporting
// docs, soft-delete.
//
// Role gating:
//   * Anyone in the org (execs, managers, admins) can CREATE a request and
//     attach a bill. This is the "someone needs to pay for electricity"
//     use-case — the site team creates the request when the bill arrives.
//   * Only accounts / manager / admin can APPROVE, MARK PAID, or REJECT.
//     Marking paid requires a payment proof upload.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  expenseCreateSchema,
  expenseMarkPaidSchema,
  expenseSetStatusSchema,
  type ExpenseCreateValues,
  type ExpenseMarkPaidValues,
  type ExpenseSetStatusValues,
} from "@/lib/validations/site-expense";
import type { UserRole } from "@/lib/types/database";

// ── Auth helpers ────────────────────────────────────────────────────────────
type AuthCtx = {
  userId: string;
  orgId: string;
  roles: UserRole[];
};

// Shared: resolve caller's auth state + org and role list. All expense actions
// need this; pulling it out keeps the action bodies readable.
async function resolveCaller(): Promise<
  { ok: true; ctx: AuthCtx } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, roles")
    .eq("id", user.id)
    .single();

  if (!profile?.org_id) return { ok: false, error: "No organization linked" };

  const rolesArr: UserRole[] =
    Array.isArray(profile.roles) && profile.roles.length > 0
      ? (profile.roles as UserRole[])
      : [profile.role as UserRole];

  return { ok: true, ctx: { userId: user.id, orgId: profile.org_id, roles: rolesArr } };
}

// Who can approve / mark paid / reject. Keep this short and auditable.
const FINANCE_ROLES: UserRole[] = ["super_admin", "admin", "manager", "accounts"];

function canSettle(roles: UserRole[]): boolean {
  return roles.some((r) => FINANCE_ROLES.includes(r));
}

// Ensure the expense-docs storage bucket exists (cheap no-op if it does).
// Used as a safety net for new Supabase projects where migration 028 may not
// have been applied yet.
async function ensureExpenseBucket(): Promise<{ error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error:
        'Storage bucket "expense-docs" is missing. Apply migration 028_site_expenses.sql or create the bucket in Supabase.',
    };
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.createBucket("expense-docs", {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
    });
    if (error && !/already exists/i.test(error.message)) {
      return { error: error.message };
    }
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create expense-docs bucket",
    };
  }
}

// ── Create a payment request ────────────────────────────────────────────────
export async function createExpense(
  values: ExpenseCreateValues,
): Promise<{ error?: string; success?: true; id?: string }> {
  const who = await resolveCaller();
  if (!who.ok) return { error: who.error };

  const parsed = expenseCreateSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const v = parsed.data;

  // If a site_id was provided, verify the site belongs to caller's org — this
  // protects against a malicious client dropping another org's site_id.
  const supabase = await createClient();
  if (v.site_id) {
    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("id, organization_id")
      .eq("id", v.site_id)
      .single();
    if (siteErr || !site || site.organization_id !== who.ctx.orgId) {
      return { error: "That site doesn't belong to your organization." };
    }
  }

  const amount_paise = Math.round(v.amount_rupees * 100);

  const { data, error } = await supabase
    .from("site_expenses")
    .insert({
      organization_id: who.ctx.orgId,
      site_id: v.site_id ?? null,
      category: v.category,
      description: v.description,
      amount_paise,
      payee_type: v.payee_type,
      payee_id: v.payee_id ?? null,
      payee_name: v.payee_name,
      payee_contact: v.payee_contact ?? null,
      payee_bank_details: v.payee_bank_details ?? null,
      status: "pending",
      needed_by: v.needed_by ?? null,
      receipt_doc_urls: v.receipt_doc_urls ?? [],
      notes: v.notes ?? null,
      created_by: who.ctx.userId,
      updated_by: who.ctx.userId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/expenses");
  if (v.site_id) revalidatePath(`/sites/${v.site_id}`);
  return { success: true, id: data.id };
}

// ── Status transitions (approve / reject / re-open) ─────────────────────────
// "Mark paid" is a separate action because it carries settlement fields.
export async function setExpenseStatus(
  values: ExpenseSetStatusValues,
): Promise<{ error?: string; success?: true }> {
  const who = await resolveCaller();
  if (!who.ok) return { error: who.error };
  if (!canSettle(who.ctx.roles)) {
    return { error: "Only accounts / manager / admin can approve or reject" };
  }

  const parsed = expenseSetStatusSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { expense_id, status } = parsed.data;

  const supabase = await createClient();
  const { data: row, error: lookupErr } = await supabase
    .from("site_expenses")
    .select("id, organization_id, site_id, status")
    .eq("id", expense_id)
    .single();
  if (lookupErr || !row) return { error: "Expense not found" };
  if (row.organization_id !== who.ctx.orgId) return { error: "Cross-org update blocked" };
  if (row.status === "paid") return { error: "Already paid — cannot change status" };

  const { error } = await supabase
    .from("site_expenses")
    .update({ status, updated_by: who.ctx.userId })
    .eq("id", expense_id);

  if (error) return { error: error.message };

  revalidatePath("/expenses");
  if (row.site_id) revalidatePath(`/sites/${row.site_id}`);
  return { success: true };
}

// ── Mark paid ───────────────────────────────────────────────────────────────
export async function markExpensePaid(
  values: ExpenseMarkPaidValues,
): Promise<{ error?: string; success?: true }> {
  const who = await resolveCaller();
  if (!who.ok) return { error: who.error };
  if (!canSettle(who.ctx.roles)) {
    return { error: "Only accounts / manager / admin can mark an expense paid" };
  }

  const parsed = expenseMarkPaidSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: row, error: lookupErr } = await supabase
    .from("site_expenses")
    .select("id, organization_id, site_id, status, payment_proof_urls, notes")
    .eq("id", v.expense_id)
    .single();
  if (lookupErr || !row) return { error: "Expense not found" };
  if (row.organization_id !== who.ctx.orgId) return { error: "Cross-org update blocked" };

  const tds_paise =
    typeof v.tds_rupees === "number" ? Math.round(v.tds_rupees * 100) : null;

  // Merge proofs rather than replace — accounts may upload a second doc later.
  const existingProofs = (row.payment_proof_urls as string[] | null) ?? [];
  const mergedProofs = [...existingProofs, ...(v.payment_proof_urls ?? [])];

  const mergedNotes =
    v.notes && v.notes.trim().length > 0
      ? (row.notes ? `${row.notes}\n\n` : "") + v.notes.trim()
      : row.notes;

  const { error } = await supabase
    .from("site_expenses")
    .update({
      status: "paid",
      paid_at: v.paid_at,
      paid_by: who.ctx.userId,
      payment_mode: v.payment_mode,
      payment_reference: v.payment_reference ?? null,
      tds_paise,
      payment_proof_urls: mergedProofs,
      notes: mergedNotes,
      updated_by: who.ctx.userId,
    })
    .eq("id", v.expense_id);

  if (error) return { error: error.message };

  revalidatePath("/expenses");
  if (row.site_id) revalidatePath(`/sites/${row.site_id}`);
  return { success: true };
}

// ── Soft-delete ─────────────────────────────────────────────────────────────
// Allowed only for pending / rejected rows. Paid rows are immutable audit
// records — accounts should never be able to "erase" a paid expense.
export async function deleteExpense(
  expenseId: string,
): Promise<{ error?: string; success?: true }> {
  const who = await resolveCaller();
  if (!who.ok) return { error: who.error };

  const supabase = await createClient();
  const { data: row, error: lookupErr } = await supabase
    .from("site_expenses")
    .select("id, organization_id, site_id, status, created_by")
    .eq("id", expenseId)
    .single();
  if (lookupErr || !row) return { error: "Expense not found" };
  if (row.organization_id !== who.ctx.orgId) return { error: "Cross-org update blocked" };
  if (row.status === "paid") {
    return { error: "Paid expenses are audit records and cannot be deleted" };
  }

  // Non-finance users can only delete their own pending rows.
  const isMine = row.created_by === who.ctx.userId;
  if (!canSettle(who.ctx.roles) && !isMine) {
    return { error: "You can only delete requests you created" };
  }

  const { error } = await supabase
    .from("site_expenses")
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: who.ctx.userId,
    })
    .eq("id", expenseId);

  if (error) return { error: error.message };

  revalidatePath("/expenses");
  if (row.site_id) revalidatePath(`/sites/${row.site_id}`);
  return { success: true };
}

// ── Upload a supporting doc ──────────────────────────────────────────────────
// Client converts File → ArrayBuffer and passes the bytes as base64. The
// server writes to storage under {org_id}/{expenseId or "inbox"}/{file}.
// Returns the storage path which the caller stores in receipt_doc_urls or
// payment_proof_urls.
//
// "inbox" is used for files uploaded while CREATING a new expense (we don't
// have an id yet). Once the expense is created, those URLs are already saved
// in receipt_doc_urls and remain in the inbox path — that's fine.
export async function uploadExpenseDoc(
  fileName: string,
  base64Data: string,
  expenseIdOrInbox: string | "inbox",
  kind: "receipt" | "proof",
): Promise<{ error?: string; path?: string }> {
  const who = await resolveCaller();
  if (!who.ok) return { error: who.error };

  if (!fileName || !base64Data) return { error: "Missing file" };
  // Limit to ~10 MB to match the bucket's own fileSizeLimit.
  const estimatedBytes = Math.floor((base64Data.length * 3) / 4);
  if (estimatedBytes > 10 * 1024 * 1024) {
    return { error: "File too large — max 10 MB" };
  }

  const ensured = await ensureExpenseBucket();
  if (ensured.error) return { error: ensured.error };

  // Build a safe path — strip everything but last path segment + keep extension.
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const subfolder = kind === "receipt" ? "receipts" : "proofs";
  const path = `${who.ctx.orgId}/${expenseIdOrInbox}/${subfolder}/${Date.now()}_${safeName}`;

  const admin = createAdminClient();
  const buffer = Buffer.from(base64Data, "base64");

  const { error: uploadError } = await admin.storage
    .from("expense-docs")
    .upload(path, buffer, {
      // Content type is best-effort guessed from extension.
      contentType: guessMime(fileName),
      upsert: false,
    });
  if (uploadError) return { error: uploadError.message };

  return { path };
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":  return "application/pdf";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png":  return "image/png";
    case "webp": return "image/webp";
    case "heic": return "image/heic";
    default:     return "application/octet-stream";
  }
}
