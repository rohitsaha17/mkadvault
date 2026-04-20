"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { contractSchema, recordPaymentSchema } from "@/lib/validations/contract";
import { addMonths, addYears, format } from "date-fns";

type ActionResult = { error: string } | { success: true; id: string };

async function getOrgAndUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("org_id").eq("id", user.id).single();
  if (!profile?.org_id) return null;
  return { supabase, user, orgId: profile.org_id };
}

function inr(v?: number) { return v !== undefined && !isNaN(v) ? Math.round(v * 100) : null; }
function str(v?: string) { return v?.trim() || null; }
function num(v?: number) { return v !== undefined && !isNaN(v) ? v : null; }

// ─── Generate payment schedule ────────────────────────────────────────────────
// Creates contract_payments rows when a contract is first saved.

async function generatePaymentSchedule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contractId: string,
  orgId: string,
  userId: string,
  paymentModel: string,
  startDate: string,
  endDate: string | null | undefined,
  rentAmountPaise: number | null,
  paymentDayOfMonth: number | null,
  paymentDate: string | null,
  revenueSharePct: number | null,
  minimumGuaranteePaise: number | null,
) {
  const start = new Date(startDate);
  // Cap at 24 months or end_date, whichever is sooner
  const maxEnd = endDate ? new Date(endDate) : addMonths(start, 24);

  const rows: {
    organization_id: string;
    contract_id: string;
    created_by: string;
    due_date: string;
    amount_due_paise: number;
    status: string;
  }[] = [];

  if (paymentModel === "monthly_fixed" || paymentModel === "custom") {
    const amountPaise = rentAmountPaise ?? 0;
    const day = paymentDayOfMonth ?? 5;
    let current = new Date(start.getFullYear(), start.getMonth(), day);
    if (current < start) current = addMonths(current, 1);

    while (current <= maxEnd) {
      rows.push({
        organization_id: orgId,
        contract_id: contractId,
        created_by: userId,
        due_date: format(current, "yyyy-MM-dd"),
        amount_due_paise: amountPaise,
        status: current <= new Date() ? "due" : "upcoming",
      });
      current = addMonths(current, 1);
    }
  } else if (paymentModel === "yearly_lumpsum") {
    const amountPaise = rentAmountPaise ?? 0;
    let current = paymentDate ? new Date(paymentDate) : new Date(start);
    if (current < start) current = addYears(current, 1);

    while (current <= maxEnd) {
      rows.push({
        organization_id: orgId,
        contract_id: contractId,
        created_by: userId,
        due_date: format(current, "yyyy-MM-dd"),
        amount_due_paise: amountPaise,
        status: current <= new Date() ? "due" : "upcoming",
      });
      current = addYears(current, 1);
    }
  } else if (paymentModel === "revenue_share") {
    // Monthly minimum guarantee rows
    const amountPaise = minimumGuaranteePaise ?? 0;
    const day = paymentDayOfMonth ?? 5;
    let current = new Date(start.getFullYear(), start.getMonth(), day);
    if (current < start) current = addMonths(current, 1);

    while (current <= maxEnd) {
      rows.push({
        organization_id: orgId,
        contract_id: contractId,
        created_by: userId,
        due_date: format(current, "yyyy-MM-dd"),
        amount_due_paise: amountPaise,
        status: current <= new Date() ? "due" : "upcoming",
      });
      current = addMonths(current, 1);
    }
  }

  if (rows.length > 0) {
    await supabase.from("contract_payments").insert(rows);
  }
}

// ─── createContract ───────────────────────────────────────────────────────────

export async function createContract(values: unknown): Promise<ActionResult> {
  const parsed = contractSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const rentPaise = inr(d.rent_amount_inr);
  const minGuaranteePaise = inr(d.minimum_guarantee_inr);

  const { data: contract, error } = await ctx.supabase
    .from("contracts")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
      contract_type: d.contract_type,
      landowner_id: d.contract_type === "landowner" ? (d.landowner_id ?? null) : null,
      agency_id: d.contract_type === "agency" ? (d.agency_id ?? null) : null,
      site_id: d.site_id,
      payment_model: d.payment_model,
      rent_amount_paise: rentPaise,
      payment_day_of_month: num(d.payment_day_of_month),
      payment_date: str(d.payment_date),
      revenue_share_percentage: num(d.revenue_share_percentage),
      minimum_guarantee_paise: minGuaranteePaise,
      escalation_percentage: num(d.escalation_percentage),
      escalation_frequency_months: num(d.escalation_frequency_months),
      start_date: d.start_date,
      end_date: str(d.end_date),
      renewal_date: str(d.renewal_date),
      notice_period_days: d.notice_period_days ?? 90,
      lock_period_months: num(d.lock_period_months),
      early_termination_clause: str(d.early_termination_clause),
      notes: str(d.notes),
      status: "active",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Auto-generate payment schedule
  await generatePaymentSchedule(
    ctx.supabase,
    contract.id,
    ctx.orgId,
    ctx.user.id,
    d.payment_model,
    d.start_date,
    d.end_date,
    rentPaise,
    d.payment_day_of_month ?? null,
    d.payment_date ?? null,
    d.revenue_share_percentage ?? null,
    minGuaranteePaise,
  );

  revalidatePath("/contracts");
  return { success: true, id: contract.id };
}

// ─── updateContract ───────────────────────────────────────────────────────────

export async function updateContract(id: string, values: unknown): Promise<ActionResult> {
  const parsed = contractSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const { error } = await ctx.supabase
    .from("contracts")
    .update({
      updated_by: ctx.user.id,
      contract_type: d.contract_type,
      landowner_id: d.contract_type === "landowner" ? (d.landowner_id ?? null) : null,
      agency_id: d.contract_type === "agency" ? (d.agency_id ?? null) : null,
      site_id: d.site_id,
      payment_model: d.payment_model,
      rent_amount_paise: inr(d.rent_amount_inr),
      payment_day_of_month: num(d.payment_day_of_month),
      payment_date: str(d.payment_date),
      revenue_share_percentage: num(d.revenue_share_percentage),
      minimum_guarantee_paise: inr(d.minimum_guarantee_inr),
      escalation_percentage: num(d.escalation_percentage),
      escalation_frequency_months: num(d.escalation_frequency_months),
      start_date: d.start_date,
      end_date: str(d.end_date),
      renewal_date: str(d.renewal_date),
      notice_period_days: d.notice_period_days ?? 90,
      lock_period_months: num(d.lock_period_months),
      early_termination_clause: str(d.early_termination_clause),
      notes: str(d.notes),
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  return { success: true, id };
}

// ─── deleteContract (soft) ────────────────────────────────────────────────────

export async function deleteContract(id: string): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const { error } = await ctx.supabase
    .from("contracts")
    .update({ deleted_at: new Date().toISOString(), status: "terminated" })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/contracts");
  return {};
}

// ─── recordPayment ────────────────────────────────────────────────────────────

export async function recordPayment(
  paymentRowId: string,
  amountDuePaise: number,
  values: unknown
): Promise<{ error?: string }> {
  const parsed = recordPaymentSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const paidPaise = Math.round(d.amount_paid_inr * 100);
  const tdsPaise = d.tds_percentage
    ? Math.round((paidPaise * d.tds_percentage) / 100)
    : null;

  const status =
    paidPaise >= amountDuePaise ? "paid" : "partially_paid";

  const { error } = await ctx.supabase
    .from("contract_payments")
    .update({
      updated_by: ctx.user.id,
      amount_paid_paise: paidPaise,
      payment_date: d.payment_date,
      payment_mode: d.payment_mode,
      payment_reference: str(d.payment_reference),
      tds_deducted_paise: tdsPaise,
      tds_percentage: d.tds_percentage ?? null,
      status,
      notes: str(d.notes),
    })
    .eq("id", paymentRowId);

  if (error) return { error: error.message };
  revalidatePath("/contracts");
  return {};
}

// ─── uploadContractDocument ───────────────────────────────────────────────────

export async function uploadContractDocument(
  contractId: string,
  formData: FormData
): Promise<{ error?: string; url?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const file = formData.get("file") as File | null;
  if (!file) return { error: "No file provided" };

  if (file.size > 10 * 1024 * 1024)
    return { error: "File too large. Max 10MB." };

  const ext = file.name.split(".").pop() ?? "pdf";
  const path = `${ctx.orgId}/${contractId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await ctx.supabase.storage
    .from("contracts")
    .upload(path, file, { upsert: true });

  if (uploadError) return { error: uploadError.message };

  await ctx.supabase
    .from("contracts")
    .update({ contract_document_url: path, updated_by: ctx.user.id })
    .eq("id", contractId);

  revalidatePath(`/contracts/${contractId}`);
  return { url: path };
}
