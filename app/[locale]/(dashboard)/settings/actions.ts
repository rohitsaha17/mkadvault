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
      .select("org_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) return { error: "Profile not found" };

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
      .select("org_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) return { error: "Profile not found" };
    if (!["super_admin", "admin"].includes(profile.role)) {
      return { error: "Only admins can update organization settings" };
    }

    // Normalize the terms template — store null when blank so the wizard's
    // "no template yet" branch fires cleanly.
    const payload: Record<string, unknown> = { ...data };
    if ("proposal_terms_template" in payload) {
      const trimmed = (payload.proposal_terms_template as string | undefined)?.trim() ?? "";
      payload.proposal_terms_template = trimmed === "" ? null : trimmed;
    }

    const { error } = await supabase
      .from("organizations")
      .update(payload)
      .eq("id", profile.org_id);

    if (error) return { error: error.message };
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
