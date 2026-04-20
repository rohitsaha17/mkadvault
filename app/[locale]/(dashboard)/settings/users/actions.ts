"use server";
// User management server actions — invite new users, update their role,
// and toggle active status. All actions are role-gated to super_admin/admin.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { UserRole } from "@/lib/types/database";

const ALLOWED_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "sales_manager",
  "operations_manager",
  "accounts",
  "viewer",
];

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
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.org_id) return { ok: false, error: "No organization linked to your profile" };
  if (!["super_admin", "admin"].includes(profile.role)) {
    return { ok: false, error: "Only admins can manage team members" };
  }
  return { ok: true, orgId: profile.org_id, userId: user.id };
}

// ─── Invite a new user ───────────────────────────────────────────────────────
// Uses the Supabase admin client to send an invite email. The handle_new_user
// trigger creates the profile row automatically; we then stamp it with the
// correct org_id, role, and full_name.
export async function inviteUser(data: {
  email: string;
  full_name: string;
  role: UserRole;
}): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  if (!data.email || !data.email.includes("@")) return { error: "Valid email required" };
  if (!data.full_name.trim()) return { error: "Full name required" };
  if (!ALLOWED_ROLES.includes(data.role)) return { error: "Invalid role" };

  const admin = createAdminClient();

  // Duplicate email check: Supabase auth will reject the invite if the email
  // already exists in auth.users. We handle that error below after inviteUserByEmail.

  // Send the invite email — this creates the auth.users row and fires the
  // handle_new_user trigger which inserts a profile row with the same id.
  const { data: inviteData, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name },
    });

  if (inviteError || !inviteData.user) {
    return { error: inviteError?.message ?? "Failed to send invite" };
  }

  // Stamp the newly-created profile with org_id, role, full_name. Bypass RLS
  // with the admin client — the trigger created an empty profile for us.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      org_id: gate.orgId,
      role: data.role,
      full_name: data.full_name,
      is_active: true,
    })
    .eq("id", inviteData.user.id);

  if (profileError) return { error: profileError.message };

  revalidatePath("/settings/users");
  return { success: true };
}

// ─── Update a user's role ────────────────────────────────────────────────────
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  if (!ALLOWED_ROLES.includes(role)) return { error: "Invalid role" };
  if (userId === gate.userId && role !== "super_admin" && role !== "admin") {
    return { error: "You cannot demote yourself out of admin" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", userId)
    .eq("org_id", gate.orgId);

  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { success: true };
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

// ─── Resend invite email ─────────────────────────────────────────────────────
export async function resendInvite(
  email: string
): Promise<{ error?: string; success?: true }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error) return { error: error.message };
  return { success: true };
}
