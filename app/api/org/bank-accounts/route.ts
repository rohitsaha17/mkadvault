// JSON API for managing organisation bank accounts.
//
//   POST   /api/org/bank-accounts           → create one
//   PATCH  /api/org/bank-accounts?id=<uuid> → update one (any field)
//   DELETE /api/org/bank-accounts?id=<uuid> → soft-delete one
//
// Admin-only (super_admin / admin). Bank details are sensitive and
// ride along on invoices.
//
// "Primary" uniqueness is enforced in Postgres via a partial unique
// index — when a new account is marked primary, we clear the existing
// primary in the same transaction (two updates in a row; RLS keeps us
// scoped to our own org).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

function jsonErr(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const ADMIN_ROLES = ["super_admin", "admin"];

// Shape shared by create/update. Everything except bank_name / account
// / ifsc is optional because users often only know the essentials.
const bankAccountSchema = z.object({
  label: z.string().trim().max(80).optional().nullable(),
  bank_name: z.string().trim().min(1, "Bank name is required").max(120),
  account_holder_name: z.string().trim().max(120).optional().nullable(),
  account_number: z.string().trim().min(1, "Account number is required").max(40),
  ifsc_code: z.string().trim().min(1, "IFSC is required").max(20),
  branch_name: z.string().trim().max(120).optional().nullable(),
  account_type: z.enum(["savings", "current", "other"]).optional().nullable(),
  upi_id: z.string().trim().max(80).optional().nullable(),
  swift_code: z.string().trim().max(20).optional().nullable(),
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

// Same schema but all keys optional for PATCH.
const bankAccountUpdateSchema = bankAccountSchema.partial().extend({
  bank_name: z.string().trim().min(1).max(120).optional(),
  account_number: z.string().trim().min(1).max(40).optional(),
  ifsc_code: z.string().trim().min(1).max(20).optional(),
});

type GuardOk = { ok: true; userId: string; orgId: string };
type GuardFail = { ok: false; res: NextResponse };

async function guard(): Promise<GuardOk | GuardFail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonErr("Not authenticated", 401) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, roles")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) {
    return { ok: false, res: jsonErr("No organisation linked", 403) };
  }
  const roles: string[] =
    Array.isArray((profile as { roles?: string[] }).roles) &&
    ((profile as { roles?: string[] }).roles?.length ?? 0) > 0
      ? ((profile as { roles?: string[] }).roles as string[])
      : [profile.role ?? ""];
  const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r));
  if (!isAdmin) {
    return {
      ok: false,
      res: jsonErr("Only admins can manage bank accounts.", 403),
    };
  }
  return { ok: true, userId: user.id, orgId: profile.org_id };
}

// If this row is being marked primary, clear the flag on any other
// primary row for this org first. Cheaper than wrapping in a function
// because RLS + the partial unique index already guard correctness.
async function clearOtherPrimary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  keepId?: string,
) {
  let q = supabase
    .from("organization_bank_accounts")
    .update({ is_primary: false })
    .eq("organization_id", orgId)
    .eq("is_primary", true);
  if (keepId) q = q.neq("id", keepId);
  await q;
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => null);
  const parsed = bankAccountSchema.safeParse(body);
  if (!parsed.success) return jsonErr(parsed.error.issues[0].message);
  const d = parsed.data;

  const supabase = await createClient();

  // If caller asked for primary, clear the current primary first so the
  // partial unique index doesn't reject the insert.
  if (d.is_primary) await clearOtherPrimary(supabase, g.orgId);

  // Auto-mark primary if this is the first account.
  let is_primary = d.is_primary ?? false;
  if (!is_primary) {
    const { count } = await supabase
      .from("organization_bank_accounts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", g.orgId)
      .is("deleted_at", null);
    if ((count ?? 0) === 0) is_primary = true;
  }

  const { data: row, error } = await supabase
    .from("organization_bank_accounts")
    .insert({
      organization_id: g.orgId,
      created_by: g.userId,
      updated_by: g.userId,
      label: d.label ?? null,
      bank_name: d.bank_name,
      account_holder_name: d.account_holder_name ?? null,
      account_number: d.account_number,
      ifsc_code: d.ifsc_code.toUpperCase(),
      branch_name: d.branch_name ?? null,
      account_type: d.account_type ?? null,
      upi_id: d.upi_id ?? null,
      swift_code: d.swift_code ?? null,
      is_primary,
      is_active: d.is_active ?? true,
      notes: d.notes ?? null,
    })
    .select("*")
    .single();

  if (error || !row) return jsonErr(error?.message ?? "Failed to create");
  return NextResponse.json({ success: true, bankAccount: row });
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonErr("Missing id");

  const body = await req.json().catch(() => null);
  const parsed = bankAccountUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonErr(parsed.error.issues[0].message);
  const d = parsed.data;

  const supabase = await createClient();

  if (d.is_primary === true) {
    await clearOtherPrimary(supabase, g.orgId, id);
  }

  const patch: Record<string, unknown> = { updated_by: g.userId };
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined) patch[k] = k === "ifsc_code" && typeof v === "string" ? v.toUpperCase() : v;
  }

  const { data: row, error } = await supabase
    .from("organization_bank_accounts")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", g.orgId)
    .select("*")
    .single();

  if (error) return jsonErr(error.message);
  return NextResponse.json({ success: true, bankAccount: row });
}

export async function DELETE(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonErr("Missing id");

  const supabase = await createClient();

  // Soft-delete + clear is_primary so the partial unique index stays happy
  // and this row stops showing up in the invoice dropdown.
  const { error } = await supabase
    .from("organization_bank_accounts")
    .update({
      deleted_at: new Date().toISOString(),
      is_primary: false,
      is_active: false,
      updated_by: g.userId,
    })
    .eq("id", id)
    .eq("organization_id", g.orgId);

  if (error) return jsonErr(error.message);
  return NextResponse.json({ success: true });
}
