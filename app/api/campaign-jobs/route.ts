// JSON API for campaign_jobs — create + update + delete. Matches the
// pattern we've used for every other mutation flow (plain fetch, always
// 200 + JSON, uniform {error} shape on failure).
//
// When a job is external AND has a cost AND the caller asks for it
// (auto_raise_payment_request=true), we also insert a linked
// site_expenses row (payment request) so the accounts team can
// approve + pay the vendor through the existing Finance flow. The
// site_expense.id gets written back to campaign_jobs.expense_id.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CampaignJobSource,
  CampaignJobStatus,
  CampaignJobType,
} from "@/lib/types/database";

function jsonOk(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...extra });
}
function jsonErr(error: string) {
  return NextResponse.json({ error });
}

const JOB_TYPES: CampaignJobType[] = [
  "print",
  "mount",
  "print_and_mount",
  "unmount",
  "repair",
  "other",
];
const JOB_SOURCES: CampaignJobSource[] = ["internal", "external"];
const JOB_STATUSES: CampaignJobStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];

// Helper: check auth + resolve org. Returns a tagged union so TS
// narrows cleanly in the callers (checking `ok` rather than
// `"error" in auth` avoids a narrowing edge case).
type AuthResult =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      admin: ReturnType<typeof createAdminClient>;
      userId: string;
      orgId: string;
      role: string | null;
    };

async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) return { ok: false, error: "No organisation linked" };

  return {
    ok: true,
    supabase,
    admin: createAdminClient(),
    userId: user.id,
    orgId: profile.org_id as string,
    role: profile.role as string | null,
  };
}

// Map job_type → site_expenses category used when auto-raising a payment
// request. All valid categories live in the site_expenses CHECK constraint.
function expenseCategoryFor(job_type: CampaignJobType): string {
  switch (job_type) {
    case "print":
      return "printing";
    case "mount":
    case "print_and_mount":
      return "mounting";
    default:
      return "other";
  }
}

// ─── POST /api/campaign-jobs — create a job ───────────────────────────────
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }

  const auth = await requireAuth();
  if (!auth.ok) return jsonErr(auth.error);
  const { supabase, userId, orgId } = auth;

  // ── Validate ───────────────────────────────────────────────────────────
  const campaign_id = typeof body.campaign_id === "string" ? body.campaign_id : "";
  const job_type = body.job_type as CampaignJobType;
  const source = (body.source as CampaignJobSource) ?? "internal";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";

  if (!campaign_id) return jsonErr("campaign_id is required");
  if (!JOB_TYPES.includes(job_type)) return jsonErr("Invalid job_type");
  if (!JOB_SOURCES.includes(source)) return jsonErr("Invalid source");
  if (!description) return jsonErr("Description is required");

  // Verify the campaign belongs to caller's org. Without this check an
  // attacker could attach a job to another tenant's campaign.
  const { data: camp } = await supabase
    .from("campaigns")
    .select("id, organization_id")
    .eq("id", campaign_id)
    .single();
  if (!camp) return jsonErr("Campaign not found");
  if (camp.organization_id !== orgId) {
    return jsonErr("Cross-organisation access blocked");
  }

  // Cost / vendor only meaningful for external source.
  const cost_rupees =
    typeof body.cost_rupees === "number" && body.cost_rupees > 0
      ? body.cost_rupees
      : null;
  const cost_paise =
    source === "external" && cost_rupees !== null
      ? Math.round(cost_rupees * 100)
      : null;

  const vendor_name =
    source === "external" && typeof body.vendor_name === "string"
      ? body.vendor_name.trim() || null
      : null;
  const vendor_contact =
    source === "external" && typeof body.vendor_contact === "string"
      ? body.vendor_contact.trim() || null
      : null;
  const vendor_agency_id =
    source === "external" && typeof body.vendor_agency_id === "string"
      ? body.vendor_agency_id
      : null;

  // Optional site links
  const campaign_site_id =
    typeof body.campaign_site_id === "string" ? body.campaign_site_id : null;
  const site_id = typeof body.site_id === "string" ? body.site_id : null;

  const scheduled_date =
    typeof body.scheduled_date === "string" && body.scheduled_date
      ? body.scheduled_date
      : null;

  const notes =
    typeof body.notes === "string" ? body.notes.trim() || null : null;

  // ── Insert the job first ──────────────────────────────────────────────
  const { data: job, error: insertErr } = await supabase
    .from("campaign_jobs")
    .insert({
      organization_id: orgId,
      campaign_id,
      campaign_site_id,
      site_id,
      job_type,
      source,
      vendor_name,
      vendor_agency_id,
      vendor_contact,
      status: "pending",
      scheduled_date,
      cost_paise,
      description,
      notes,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .single();
  if (insertErr) return jsonErr(`Insert failed: ${insertErr.message}`);

  // ── Optionally auto-raise a payment request ────────────────────────────
  // Only makes sense for external jobs with a non-zero cost.
  const autoRaise =
    body.auto_raise_payment_request === true &&
    source === "external" &&
    cost_paise !== null &&
    cost_paise > 0;

  let linkedExpenseId: string | null = null;
  let raiseWarning: string | null = null;

  if (autoRaise) {
    const payeeName = vendor_name ?? "External vendor";
    const { data: expense, error: expenseErr } = await supabase
      .from("site_expenses")
      .insert({
        organization_id: orgId,
        site_id,
        category: expenseCategoryFor(job_type),
        description: `${description} (campaign job)`,
        amount_paise: cost_paise,
        payee_type: vendor_agency_id ? "agency" : "vendor",
        payee_id: vendor_agency_id,
        payee_name: payeeName,
        payee_contact: vendor_contact,
        status: "pending",
        notes: notes ? `From campaign job.\n${notes}` : "From campaign job.",
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();

    if (expenseErr) {
      // Don't fail the job creation — just warn the caller. They can
      // raise the request manually from the job row if needed.
      raiseWarning = `Job created, but the payment request couldn't be raised: ${expenseErr.message}`;
    } else {
      linkedExpenseId = expense.id as string;
      await supabase
        .from("campaign_jobs")
        .update({ expense_id: linkedExpenseId, updated_by: userId })
        .eq("id", job.id);
    }
  }

  return jsonOk({
    job: { ...job, expense_id: linkedExpenseId ?? job.expense_id ?? null },
    expense_id: linkedExpenseId,
    warning: raiseWarning,
  });
}

// ─── PATCH /api/campaign-jobs — update status, mark completed, etc. ────────
export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return jsonErr("id is required");

  const auth = await requireAuth();
  if (!auth.ok) return jsonErr(auth.error);
  const { supabase, userId, orgId } = auth;

  // Load the job to verify org ownership.
  const { data: existing } = await supabase
    .from("campaign_jobs")
    .select("id, organization_id, source")
    .eq("id", id)
    .single();
  if (!existing) return jsonErr("Job not found");
  if (existing.organization_id !== orgId) {
    return jsonErr("Cross-organisation access blocked");
  }

  const patch: Record<string, unknown> = { updated_by: userId };

  if (typeof body.status === "string") {
    if (!JOB_STATUSES.includes(body.status as CampaignJobStatus)) {
      return jsonErr("Invalid status");
    }
    patch.status = body.status;
    // Convenience: when moving to completed and no completed_date was
    // supplied, stamp today so reports show when it actually happened.
    if (body.status === "completed" && !body.completed_date) {
      patch.completed_date = new Date().toISOString().slice(0, 10);
    }
  }
  if (body.completed_date === null || typeof body.completed_date === "string") {
    patch.completed_date = body.completed_date || null;
  }
  if (body.scheduled_date === null || typeof body.scheduled_date === "string") {
    patch.scheduled_date = body.scheduled_date || null;
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim();
  }
  if (body.notes === null || typeof body.notes === "string") {
    patch.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }
  if (typeof body.vendor_name === "string") {
    patch.vendor_name = body.vendor_name.trim() || null;
  }
  if (typeof body.vendor_contact === "string") {
    patch.vendor_contact = body.vendor_contact.trim() || null;
  }
  if (typeof body.cost_rupees === "number" && existing.source === "external") {
    patch.cost_paise = body.cost_rupees > 0 ? Math.round(body.cost_rupees * 100) : null;
  }

  const { data: updated, error: updErr } = await supabase
    .from("campaign_jobs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return jsonErr(`Update failed: ${updErr.message}`);

  return jsonOk({ job: updated });
}

// ─── DELETE — soft-delete (sets deleted_at) ─────────────────────────────
export async function DELETE(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return jsonErr("id is required");

  const auth = await requireAuth();
  if (!auth.ok) return jsonErr(auth.error);
  const { supabase, userId, orgId } = auth;

  const { data: existing } = await supabase
    .from("campaign_jobs")
    .select("id, organization_id, expense_id")
    .eq("id", id)
    .single();
  if (!existing) return jsonErr("Job not found");
  if (existing.organization_id !== orgId) {
    return jsonErr("Cross-organisation access blocked");
  }

  const { error: delErr } = await supabase
    .from("campaign_jobs")
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (delErr) return jsonErr(`Delete failed: ${delErr.message}`);

  return jsonOk({
    // Let the client know if there was a linked expense it might also
    // want to cancel. We don't auto-cancel because the payment might
    // have already been processed.
    linked_expense_id: existing.expense_id ?? null,
  });
}
