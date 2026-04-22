"use server";
// User management server actions — invite new users, update their role(s),
// and toggle active status. All actions are role-gated to super_admin/admin.
//
// The multi-role combo {executive, accounts} is allowed and validated here
// AND at the DB layer via a CHECK constraint on profiles.roles.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@/lib/types/database";
import { USER_ROLES, isExecutiveAccountsCombo } from "@/lib/constants";

// ─── Validation ──────────────────────────────────────────────────────────────

// Returns an error message string if the set of roles is invalid, or null if
// it's acceptable. Rules:
//   * At least one role
//   * Every role is a known role value
//   * Either a single role OR exactly {executive, accounts}
function validateRoles(roles: readonly UserRole[]): string | null {
  if (!roles || roles.length === 0) return "Pick at least one role";
  for (const r of roles) {
    if (!USER_ROLES.includes(r)) return `Unknown role: ${r}`;
  }
  if (roles.length === 1) return null;
  if (roles.length === 2 && isExecutiveAccountsCombo(roles)) return null;
  return "Only the Executive + Accountant combination is allowed for multi-role users";
}

// Helper: verify caller is an admin and return their org_id
async function requireAdmin(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
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

  if (!profile?.org_id) return { ok: false, error: "No organization linked to your profile" };

  // Admin gate checks the roles[] array if present, falling back to `role`.
  const adminRoles: UserRole[] = ["super_admin", "admin"];
  const rolesList = (profile.roles as UserRole[] | null | undefined) ?? [profile.role as UserRole];
  const isAdmin = rolesList.some((r) => adminRoles.includes(r));
  if (!isAdmin) {
    return { ok: false, error: "Only admins can manage team members" };
  }
  return { ok: true, orgId: profile.org_id, userId: user.id };
}

// ─── Invite a new user ───────────────────────────────────────────────────────
// Uses the Supabase admin client to send an invite email. The handle_new_user
// trigger creates the profile row automatically; we then stamp it with the
// correct org_id, role(s), and full_name.
export async function inviteUser(data: {
  email: string;
  full_name: string;
  roles: UserRole[];
}): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  if (!data.email || !data.email.includes("@")) return { error: "Valid email required" };
  if (!data.full_name.trim()) return { error: "Full name required" };

  const roleError = validateRoles(data.roles);
  if (roleError) return { error: roleError };

  const admin = createAdminClient();

  // Where to send the invitee after they click the email link. Supabase's
  // default is the project's Site URL (usually "/"), which would skip our
  // /auth/callback handler and therefore skip the accept-invite welcome
  // screen. Point it explicitly at /auth/callback so the PKCE code is
  // exchanged and `needs_password_setup` is detected.
  //
  // NEXT_PUBLIC_APP_URL is used in production; in local dev we fall back
  // to the request's own origin via NEXT_PUBLIC_SITE_URL or localhost.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const redirectTo = `${appUrl.replace(/\/$/, "")}/auth/callback`;

  // Send the invite email — this creates the auth.users row and fires the
  // handle_new_user trigger which inserts a profile row with the same id.
  //
  // We stamp `needs_password_setup: true` into user_metadata so the auth
  // callback can detect an invite acceptance and route the user through
  // the /accept-invite flow (welcome screen + password set) instead of
  // dropping them straight on /dashboard.
  const { data: inviteData, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(data.email, {
      data: {
        full_name: data.full_name,
        needs_password_setup: true,
      },
      redirectTo,
    });

  if (inviteError || !inviteData.user) {
    return { error: inviteError?.message ?? "Failed to send invite" };
  }

  // Stamp the newly-created profile with org_id, role(s), full_name. Bypass
  // RLS with the admin client. We set both `role` (primary) and `roles[]`
  // explicitly so they're guaranteed consistent even if the sync trigger
  // hasn't been applied yet.
  const primaryRole = data.roles[0];
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      org_id: gate.orgId,
      role: primaryRole,
      roles: data.roles,
      full_name: data.full_name,
      is_active: true,
    })
    .eq("id", inviteData.user.id);

  if (profileError) return { error: profileError.message };

  revalidatePath("/settings/users");
  return { success: true };
}

// ─── Update a user's role(s) ─────────────────────────────────────────────────
// Accepts a single role OR the {executive, accounts} combo.
export async function updateUserRoles(
  userId: string,
  roles: UserRole[]
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const roleError = validateRoles(roles);
  if (roleError) return { error: roleError };

  // Prevent an admin from demoting themselves out of an admin role.
  if (userId === gate.userId) {
    const stillAdmin = roles.includes("super_admin") || roles.includes("admin");
    if (!stillAdmin) {
      return { error: "You cannot demote yourself out of admin" };
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: roles[0], roles })
    .eq("id", userId)
    .eq("org_id", gate.orgId);

  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { success: true };
}

// Legacy single-role update — kept for call-sites that only pass one role.
// Just delegates to updateUserRoles with a one-element array.
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ error?: string; success?: true }> {
  return updateUserRoles(userId, [role]);
}

// ─── Toggle a user's active status ───────────────────────────────────────────
export async function setUserActive(
  userId: string,
  isActive: boolean
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  if (userId === gate.userId && !isActive) {
    return { error: "You cannot deactivate your own account" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", userId)
    .eq("org_id", gate.orgId);

  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { success: true };
}

// ─── Hard-delete a user (permanent) ──────────────────────────────────────────
// Guards:
//   * Admin-gated
//   * Cannot delete self
//   * Target must be in the caller's org
// Both active and deactivated users can be deleted — the UI is expected to
// confirm this destructive action. The sequence is:
//   1. Scan every `{ table, column }` in OWNED_BY_TABLES for rows still
//      pointing at this user. If any are found AND migration 027 hasn't
//      rewritten the FKs to ON DELETE SET NULL, we proactively NULL them
//      with the service-role client so the subsequent auth-user delete
//      doesn't blow up mid-way.
//   2. Delete the profile row (defensive — it also CASCADE-deletes from
//      auth.users, but we do it first so no stale row is left over if the
//      auth delete later fails).
//   3. Delete the auth.users row.
// The whole thing is wrapped in a top-level try/catch so any unexpected
// throw (network, missing service-role key, a CHECK constraint we hadn't
// predicted) returns JSON `{ error }` to the client instead of propagating
// and corrupting the RSC response — which is what produced the "unexpected
// response was received from the server" error the user was seeing.
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
  // 028 tables — harmless no-op if site_expenses doesn't exist yet in older DBs.
  { table: "site_expenses",            columns: ["created_by", "updated_by", "paid_by"] },
];

export async function deleteUser(
  userId: string,
): Promise<{ error?: string; success?: true }> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return { error: gate.error };

    if (userId === gate.userId) {
      return { error: "You cannot delete your own account" };
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return {
        error:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY — set it in .env.local (and in Vercel) before trying to delete users.",
      };
    }

    const admin = createAdminClient();

    // ── Verify target is in this org ──────────────────────────────────────
    const { data: target, error: lookupError } = await admin
      .from("profiles")
      .select("id, org_id")
      .eq("id", userId)
      .single();

    if (lookupError || !target) return { error: "User not found" };
    if (target.org_id !== gate.orgId) {
      return { error: "User is not in your organization" };
    }

    // ── Pre-clear ownership refs so FK cascades can't block the delete ────
    // Migration 027 sets every FK to ON DELETE SET NULL, but if the admin
    // hasn't applied it yet we'd still fail downstream. Proactively NULL
    // them here with the service-role client — idempotent, cheap, and
    // silent if a table doesn't exist in their schema yet.
    for (const { table, columns } of OWNED_BY_TABLES) {
      for (const column of columns) {
        const { error: updErr } = await admin
          .from(table)
          .update({ [column]: null })
          .eq(column, userId);
        // We don't stop on error here — most failures are "table doesn't
        // exist" (42P01) or "column doesn't exist" (42703) in DBs that
        // haven't applied every migration. Those are safe to ignore.
        if (
          updErr &&
          updErr.code !== "42P01" &&
          updErr.code !== "42703" &&
          updErr.code !== "PGRST116"
        ) {
          // Real failure — surface it so the admin knows something is wrong.
          return {
            error: `Failed clearing ${table}.${column}: ${updErr.message}`,
          };
        }
      }
    }

    // ── Delete the profile row (CASCADE also fires when auth.users goes) ──
    const { error: profileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", userId)
      .eq("org_id", gate.orgId);
    if (profileError) {
      // 23503 = FK violation. Should not happen now that we've pre-cleared
      // ownership refs, but catch it with a helpful message just in case.
      if ("code" in profileError && profileError.code === "23503") {
        return {
          error:
            "This user still owns records we couldn't auto-clear. Apply migration 027 so every ownership FK is ON DELETE SET NULL, then try again.",
        };
      }
      return { error: profileError.message };
    }

    // ── Delete the auth.users row ─────────────────────────────────────────
    // Wrap in try/catch because the Supabase SDK sometimes throws on 500s
    // from GoTrue (e.g. downstream FK violation we didn't anticipate) rather
    // than returning { error }.
    try {
      const { error: authError } = await admin.auth.admin.deleteUser(userId);
      if (authError) {
        if (/foreign key|violates/i.test(authError.message)) {
          return {
            error:
              "Cannot delete: the user still has linked records that aren't owned-by columns. Check custom tables referencing auth.users(id) and add ON DELETE SET NULL.",
          };
        }
        return { error: authError.message };
      }
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? `Auth delete failed: ${err.message}`
            : "Auth delete failed with an unknown error",
      };
    }

    revalidatePath("/settings/users");
    return { success: true };
  } catch (err) {
    // Absolute last-ditch safety net — Server Actions that throw return
    // HTML error pages to the client, which the RSC runtime surfaces as
    // "An unexpected response was received from the server." Convert any
    // unhandled throw into a well-formed JSON response.
    console.error("[deleteUser] unexpected error:", err);
    return {
      error:
        err instanceof Error
          ? `Unexpected error while deleting user: ${err.message}`
          : "Unexpected error while deleting user",
    };
  }
}

// ─── Update profile fields (name, phone) ─────────────────────────────────────
export async function updateUserProfile(
  userId: string,
  data: { full_name?: string; phone?: string | null },
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const patch: Record<string, string | null> = {};
  if (data.full_name !== undefined) {
    const name = data.full_name.trim();
    if (!name) return { error: "Full name cannot be empty" };
    patch.full_name = name;
  }
  if (data.phone !== undefined) {
    patch.phone = data.phone?.trim() || null;
  }
  if (Object.keys(patch).length === 0) return { success: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .eq("org_id", gate.orgId);
  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { success: true };
}

// ─── Admin-reset a user's password ──────────────────────────────────────────
// Super admins and admins can set a new password for any user in their org.
// Guards:
//   * Admin-gated
//   * Target must be in the caller's org
//   * Password must be at least 8 characters (Supabase's default minimum)
// The user is NOT signed out of active sessions automatically — if you want
// to force re-login, call admin.auth.admin.signOut(userId) after this.
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  if (!newPassword || newPassword.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const admin = createAdminClient();

  // Verify target is in the caller's org before touching the auth record.
  const { data: target, error: lookupError } = await admin
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId)
    .single();
  if (lookupError || !target) return { error: "User not found" };
  if (target.org_id !== gate.orgId) {
    return { error: "User is not in your organization" };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { success: true };
}

// ─── Resend invite email ─────────────────────────────────────────────────────
export async function resendInvite(
  email: string
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const redirectTo = `${appUrl.replace(/\/$/, "")}/auth/callback`;

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { needs_password_setup: true },
    redirectTo,
  });
  if (error) return { error: error.message };
  return { success: true };
}
