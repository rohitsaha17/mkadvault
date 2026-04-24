"use server";
// Settings page server actions

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { AlertType } from "@/lib/types/database";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
// ─── Upsert a single alert preference ────────────────────────────────────────

export async function upsertAlertPreference(data: {
  alert_type: AlertType;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
  advance_days: number[];
}): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role, roles")
      .eq("id", user.id)
      .single();

    if (!profile) return { error: "Profile not found" };

    // Alert-preference config is an ORG-WIDE concern — it drives who gets
    // which notifications and through which channels. Only admins /
    // super_admins are allowed to change it. Non-admin callers can still
    // READ their own prefs (via RLS on the table) but this mutation is
    // role-gated both here and in the UI.
    const adminRoles = ["super_admin", "admin"];
    const callerRoles: string[] =
      Array.isArray(profile.roles) && profile.roles.length > 0
        ? profile.roles
        : [profile.role ?? ""];
    const isAdmin = callerRoles.some((r) => adminRoles.includes(r));
    if (!isAdmin) {
      return {
        error:
          "Only admins and super admins can edit alert preferences. Ask your organisation admin.",
      };
    }

    // Upsert — if a preference for this org+user+type exists, update it; else insert
    const { error } = await supabase
      .from("alert_preferences")
      .upsert(
        {
          organization_id: profile.org_id,
          user_id: user.id,
          role: null, // user-level preference takes precedence over role-level
          alert_type: data.alert_type,
          in_app: data.in_app,
          email: data.email,
          whatsapp: data.whatsapp,
          advance_days: data.advance_days,
        },
        { onConflict: "organization_id,user_id,alert_type" }
      );

    if (error) return { error: error.message };
    revalidatePath("/settings");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "upsertAlertPreference");
  }
}

// ─── Update organization info ─────────────────────────────────────────────────

export async function updateOrganization(data: {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pin_code?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  // Org-wide default text for proposal / rate-card Terms & Conditions.
  // Empty string clears the template.
  proposal_terms_template?: string;
}): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role, roles")
      .eq("id", user.id)
      .single();

    if (!profile) return { error: "Profile not found" };
    // Check the full roles array — migration 020 introduced multi-role
    // users, and an admin whose primary `role` column is set to
    // something else (or a legacy row with role null and roles
    // populated) should still be allowed to save org settings.
    const rolesArr: string[] = Array.isArray(profile.roles) && profile.roles.length > 0
      ? (profile.roles as string[])
      : profile.role
      ? [profile.role as string]
      : [];
    const isAdmin = rolesArr.some((r) =>
      ["super_admin", "admin"].includes(r),
    );
    if (!isAdmin) {
      return { error: "Only admins can update organization settings" };
    }

    // Split the update: core fields always go through; the
    // proposal_terms_template column only exists after migration 026 has
    // been applied, so we write it in a separate UPDATE and swallow the
    // "column does not exist" error (42703). This keeps Save working on
    // environments where 026 isn't live yet.
    const { proposal_terms_template, ...core } = data;

    const { error } = await supabase
      .from("organizations")
      .update(core)
      .eq("id", profile.org_id);

    if (error) return { error: error.message };

    if (proposal_terms_template !== undefined) {
      const trimmed = proposal_terms_template.trim();
      const value = trimmed === "" ? null : trimmed;
      const { error: tplErr } = await supabase
        .from("organizations")
        .update({ proposal_terms_template: value })
        .eq("id", profile.org_id);
      // 42703 = undefined_column; ignore so the save as a whole still
      // succeeds when migration 026 hasn't been applied.
      if (tplErr && tplErr.code !== "42703") return { error: tplErr.message };
    }
    revalidatePath("/settings");
    revalidatePath("/proposals");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateOrganization");
  }
}

// ─── Update user profile ──────────────────────────────────────────────────────

export async function updateProfile(data: {
  full_name?: string;
  phone?: string;
}): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { error } = await supabase
      .from("profiles")
      .update(data)
      .eq("id", user.id);

    if (error) return { error: error.message };
    revalidatePath("/settings");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateProfile");
  }
}
