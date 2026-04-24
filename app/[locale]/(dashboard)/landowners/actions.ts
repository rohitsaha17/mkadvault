"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { landownerSchema } from "@/lib/validations/landowner";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
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

// Coerce empty strings to null for DB
function str(v?: string) { return v?.trim() || null; }

export async function createLandowner(values: unknown): Promise<ActionResult> {
  try {
    const parsed = landownerSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;
    const { data, error } = await ctx.supabase
      .from("landowners")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        full_name: d.full_name,
        phone: str(d.phone),
        phone_alt: str(d.phone_alt),
        email: str(d.email),
        address: str(d.address),
        city: str(d.city),
        state: str(d.state),
        pin_code: str(d.pin_code),
        pan_number: str(d.pan_number),
        aadhaar_reference: str(d.aadhaar_reference),
        bank_name: str(d.bank_name),
        bank_account_number: str(d.bank_account_number),
        bank_ifsc: str(d.bank_ifsc),
        notes: str(d.notes),
      })
      .select("id")
      .single();

    if (error) return { error: error.message };
    revalidatePath("/landowners");
    return { success: true, id: data.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createLandowner");
  }
}

export async function updateLandowner(id: string, values: unknown): Promise<ActionResult> {
  try {
    const parsed = landownerSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;
    const { error } = await ctx.supabase
      .from("landowners")
      .update({
        updated_by: ctx.user.id,
        full_name: d.full_name,
        phone: str(d.phone),
        phone_alt: str(d.phone_alt),
        email: str(d.email),
        address: str(d.address),
        city: str(d.city),
        state: str(d.state),
        pin_code: str(d.pin_code),
        pan_number: str(d.pan_number),
        aadhaar_reference: str(d.aadhaar_reference),
        bank_name: str(d.bank_name),
        bank_account_number: str(d.bank_account_number),
        bank_ifsc: str(d.bank_ifsc),
        notes: str(d.notes),
      })
      .eq("id", id);

    if (error) return { error: error.message };
    revalidatePath("/landowners");
    revalidatePath(`/landowners/${id}`);
    return { success: true, id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateLandowner");
  }
}

export async function deleteLandowner(id: string): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Role check — only super_admin and admin can delete
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("role")
      .eq("id", ctx.user.id)
      .single();
    if (!profile || !["super_admin", "admin"].includes(profile.role)) {
      return { error: "Only admins can delete records" };
    }

    // Guard: check for active contracts linked to this landowner
    const { count: activeContracts } = await ctx.supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("counterparty_id", id)
      .eq("status", "active")
      .is("deleted_at", null);

    if (activeContracts && activeContracts > 0) {
      return { error: "Cannot delete landowner with active contracts" };
    }

    const { error } = await ctx.supabase.rpc("soft_delete_row", {
      p_table: "landowners",
      p_id: id,
    });
    if (error) return { error: error.message };
    revalidatePath("/landowners");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteLandowner");
  }
}
