// JSON API for user management — replaces the Server Actions that kept
// surfacing "An unexpected response was received from the server."
//
// We hit this here with a plain POST → JSON request from the client and
// get a plain JSON response back. That completely sidesteps Next.js's
// Server Action framework (RSC streaming, action IDs, revalidation
// payload encoding, intl URL rewriting, proxy redirects), every one of
// which was a potential source of the RSC-parse error the user kept
// seeing. A route handler just returns a Response object — there is no
// stream, no re-render, no framework magic.
//
// One consolidated POST endpoint; the request body carries an `action`
// discriminator so we don't have to add a new file for every mutation.
//
// Auth: each handler calls requireAdmin() which inspects the caller's
// Supabase cookies the same way the old Server Actions did.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types/database";
import { USER_ROLES, isExecutiveAccountsCombo } from "@/lib/constants";

// ─── Shared helpers (lifted verbatim from actions.ts) ──────────────────────

function validateRoles(roles: readonly UserRole[]): string | null {
  if (!roles || roles.length === 0) return "Pick at least one role";
  for (const r of roles) {
    if (!USER_ROLES.includes(r)) return `Unknown role: ${r}`;
  }
  if (roles.length === 1) return null;
  if (roles.length === 2 && isExecutiveAccountsCombo(roles)) return null;
  return "Only the Executive + Accountant combination is allowed for multi-role users";
}

type AdminGate =
  | { ok: true; orgId: string; userId: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<AdminGate> {
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

  if (!profile?.org_id) return { ok: false, error: "No organization linked to your profile" };

  const adminRoles: UserRole[] = ["super_admin", "admin"];
  const rolesList = (profile.roles as UserRole[] | null | undefined) ?? [profile.role as UserRole];
  const isAdmin = rolesList.some((r) => adminRoles.includes(r));
  if (!isAdmin) return { ok: false, error: "Only admins can manage team members" };
  return { ok: true, orgId: profile.org_id, userId: user.id };
}

// Tables whose `created_by` / `updated_by` / etc. FK back to auth.users.id.
// Pre-cleared on delete so the FK cascade doesn't block us in DBs where
// migration 027 hasn't been applied yet.
const OWNED_BY_TABLES: { table: string; columns: string[] }[] = [
  { table: "sites",                    columns: ["created_by", "updated_by"] },
  { table: "site_photos",              columns: ["created_by"] },
  { table: "landowners",               columns: ["created_by", "updated_by"] },
  { table: "partner_agencies",         columns: ["created_by", "updated_by"] },
  { table: "contracts",                columns: ["created_by", "updated_by"] },
  { table: "contract_amendments",      columns: ["created_by"] },
  { table: "contract_payments",        columns: ["created_by", "updated_by"] },
  { table: "signed_agreements",        columns: ["created_by", "updated_by"] },
  { table: "clients",                  columns: ["created_by", "updated_by"] },
  { table: "campaigns",                columns: ["created_by", "updated_by"] },
  { table: "proposals",                columns: ["created_by", "updated_by"] },
  { table: "invoices",                 columns: ["created_by", "updated_by"] },
  { table: "payments_received",        columns: ["created_by"] },
  { table: "campaign_change_requests", columns: ["requested_by", "reviewed_by"] },
  { table: "site_expenses",            columns: ["created_by", "updated_by", "paid_by"] },
];

// Helper: always return a well-formed JSON response.
function jsonOk(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...extra });
}
function jsonErr(message: string, status = 200) {
  // We return 200 with {error} rather than 400 because the client looks at
  // response body, and non-2xx combined with a parse failure could surface
  // a confusing fallback error. This keeps the protocol uniform.
  return NextResponse.json({ error: message }, { status });
}

// ─── Action handlers ───────────────────────────────────────────────────────

async function handleInvite(body: {
  email?: unknown;
  full_name?: unknown;
  roles?: unknown;
}) {
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const roles = Array.isArray(body.roles) ? (body.roles as UserRole[]) : [];

  if (!email || !email.includes("@")) return jsonErr("Valid email required");
  if (!fullName) return jsonErr("Full name required");
  const roleErr = validateRoles(roles);
  if (roleErr) return jsonErr(roleErr);

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonErr(
      "Server is missing SUPABASE_SERVICE_ROLE_KEY — set it in .env.local (and in Vercel) before inviting users.",
    );
  }

  const admin = createAdminClient();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const redirectTo = `${appUrl.replace(/\/$/, "")}/auth/callback`;

  let inviteUserId: string | null = null;
  let inviteErrorMessage: string | null = null;
  try {
    const res = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, needs_password_setup: true },
      redirectTo,
    });
    inviteUserId = res.data?.user?.id ?? null;
    inviteErrorMessage = res.error?.message ?? null;
  } catch (err) {
    inviteErrorMessage = err instanceof Error ? err.message : "Failed to send invite";
  }
  if (inviteErrorMessage || !inviteUserId) {
    return jsonErr(inviteErrorMessage ?? "Failed to send invite");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      org_id: gate.orgId,
      role: roles[0],
      roles,
      full_name: fullName,
      is_active: true,
    })
    .eq("id", inviteUserId);
  if (profileError) return jsonErr(profileError.message);

  return jsonOk();
}

async function handleUpdateRoles(body: { user_id?: unknown; roles?: unknown }) {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const roles = Array.isArray(body.roles) ? (body.roles as UserRole[]) : [];
  if (!userId) return jsonErr("user_id required");
  const roleErr = validateRoles(roles);
  if (roleErr) return jsonErr(roleErr);

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);
  if (userId === gate.userId) {
    const stillAdmin = roles.includes("super_admin") || roles.includes("admin");
    if (!stillAdmin) return jsonErr("You cannot demote yourself out of admin");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: roles[0], roles })
    .eq("id", userId)
    .eq("org_id", gate.orgId);
  if (error) return jsonErr(error.message);
  return jsonOk();
}

async function handleSetActive(body: { user_id?: unknown; is_active?: unknown }) {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const isActive = body.is_active === true;
  if (!userId) return jsonErr("user_id required");

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);
  if (userId === gate.userId && !isActive) {
    return jsonErr("You cannot deactivate your own account");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId)
    .eq("org_id", gate.orgId);
  if (error) return jsonErr(error.message);
  return jsonOk();
}

async function handleUpdateProfile(body: {
  user_id?: unknown;
  full_name?: unknown;
  phone?: unknown;
}) {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  if (!userId) return jsonErr("user_id required");

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);

  const patch: Record<string, string | null> = {};
  if (body.full_name !== undefined) {
    const name = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (!name) return jsonErr("Full name cannot be empty");
    patch.full_name = name;
  }
  if (body.phone !== undefined) {
    const raw = typeof body.phone === "string" ? body.phone.trim() : "";
    patch.phone = raw || null;
  }
  if (Object.keys(patch).length === 0) return jsonOk();

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .eq("org_id", gate.orgId);
  if (error) return jsonErr(error.message);
  return jsonOk();
}

async function handleSetPassword(body: { user_id?: unknown; password?: unknown }) {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!userId) return jsonErr("user_id required");
  if (password.length < 8) return jsonErr("Password must be at least 8 characters");

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);

  const admin = createAdminClient();
  const { data: target, error: lookupErr } = await admin
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId)
    .single();
  if (lookupErr || !target) return jsonErr("User not found");
  if (target.org_id !== gate.orgId) return jsonErr("User is not in your organization");

  try {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return jsonErr(error.message);
  } catch (err) {
    return jsonErr(
      err instanceof Error ? `Password update failed: ${err.message}` : "Password update failed",
    );
  }
  return jsonOk();
}

async function handleDelete(body: { user_id?: unknown }) {
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  if (!userId) return jsonErr("user_id required");

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);
  if (userId === gate.userId) return jsonErr("You cannot delete your own account");

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonErr(
      "Server is missing SUPABASE_SERVICE_ROLE_KEY — set it in .env.local (and in Vercel) before trying to delete users.",
    );
  }

  const admin = createAdminClient();

  const { data: target, error: lookupErr } = await admin
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId)
    .single();
  if (lookupErr || !target) return jsonErr("User not found");
  if (target.org_id !== gate.orgId) return jsonErr("User is not in your organization");

  for (const { table, columns } of OWNED_BY_TABLES) {
    for (const column of columns) {
      const { error: updErr } = await admin
        .from(table)
        .update({ [column]: null })
        .eq(column, userId);
      if (
        updErr &&
        updErr.code !== "42P01" &&
        updErr.code !== "42703" &&
        updErr.code !== "PGRST116"
      ) {
        return jsonErr(`Failed clearing ${table}.${column}: ${updErr.message}`);
      }
    }
  }

  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .eq("id", userId)
    .eq("org_id", gate.orgId);
  if (profileError) {
    if ("code" in profileError && profileError.code === "23503") {
      return jsonErr(
        "This user still owns records we couldn't auto-clear. Apply migration 027 so every ownership FK is ON DELETE SET NULL, then try again.",
      );
    }
    return jsonErr(profileError.message);
  }

  try {
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      if (/foreign key|violates/i.test(authError.message)) {
        return jsonErr(
          "Cannot delete: the user still has linked records that aren't owned-by columns. Check custom tables referencing auth.users(id) and add ON DELETE SET NULL.",
        );
      }
      return jsonErr(authError.message);
    }
  } catch (err) {
    return jsonErr(
      err instanceof Error ? `Auth delete failed: ${err.message}` : "Auth delete failed",
    );
  }
  return jsonOk();
}

async function handleResend(body: { email?: unknown }) {
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return jsonErr("email required");

  const gate = await requireAdmin();
  if (!gate.ok) return jsonErr(gate.error);

  const admin = createAdminClient();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const redirectTo = `${appUrl.replace(/\/$/, "")}/auth/callback`;

  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { needs_password_setup: true },
      redirectTo,
    });
    if (error) return jsonErr(error.message);
  } catch (err) {
    return jsonErr(
      err instanceof Error ? `Failed to resend invite: ${err.message}` : "Failed to resend invite",
    );
  }
  return jsonOk();
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "invite":          return await handleInvite(body);
      case "update_roles":    return await handleUpdateRoles(body);
      case "set_active":      return await handleSetActive(body);
      case "update_profile":  return await handleUpdateProfile(body);
      case "set_password":    return await handleSetPassword(body);
      case "delete":          return await handleDelete(body);
      case "resend_invite":   return await handleResend(body);
      default:
        return jsonErr(`Unknown action: ${action || "(missing)"}`);
    }
  } catch (err) {
    console.error(`[api/settings/users:${action}] unhandled error:`, err);
    return jsonErr(
      err instanceof Error ? err.message : "Unexpected server error. Please try again.",
    );
  }
}
