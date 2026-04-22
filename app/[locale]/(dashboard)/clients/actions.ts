"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { clientSchema } from "@/lib/validations/client";

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

function str(v?: string) { return v?.trim() || null; }

export async function createClientRecord(values: unknown): Promise<ActionResult> {
  try {
    const parsed = clientSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;
    const { data, error } = await ctx.supabase
      .from("clients")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        company_name: d.company_name,
        brand_name: str(d.brand_name),
        industry_category: str(d.industry_category),
        client_type: d.client_type,
        primary_contact_name: str(d.primary_contact_name),
        primary_contact_phone: str(d.primary_contact_phone),
        primary_contact_email: str(d.primary_contact_email),
        secondary_contact_name: str(d.secondary_contact_name),
        secondary_contact_phone: str(d.secondary_contact_phone),
        secondary_contact_email: str(d.secondary_contact_email),
        billing_contact_name: str(d.billing_contact_name),
        billing_contact_phone: str(d.billing_contact_phone),
        billing_contact_email: str(d.billing_contact_email),
        gstin: str(d.gstin),
        pan: str(d.pan),
        billing_address: str(d.billing_address),
        billing_city: str(d.billing_city),
        billing_state: str(d.billing_state),
        billing_pin_code: str(d.billing_pin_code),
        credit_terms: d.credit_terms,
        notes: str(d.notes),
      })
      .select("id")
      .single();

    if (error) return { error: error.message };
    revalidatePath("/clients");
    return { success: true, id: data.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createClientRecord");
  }
}

export async function updateClientRecord(id: string, values: unknown): Promise<ActionResult> {
  try {
    const parsed = clientSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;
    const { error } = await ctx.supabase
      .from("clients")
      .update({
        updated_by: ctx.user.id,
        company_name: d.company_name,
        brand_name: str(d.brand_name),
        industry_category: str(d.industry_category),
        client_type: d.client_type,
        primary_contact_name: str(d.primary_contact_name),
        primary_contact_phone: str(d.primary_contact_phone),
        primary_contact_email: str(d.primary_contact_email),
        secondary_contact_name: str(d.secondary_contact_name),
        secondary_contact_phone: str(d.secondary_contact_phone),
        secondary_contact_email: str(d.secondary_contact_email),
        billing_contact_name: str(d.billing_contact_name),
        billing_contact_phone: str(d.billing_contact_phone),
        billing_contact_email: str(d.billing_contact_email),
        gstin: str(d.gstin),
        pan: str(d.pan),
        billing_address: str(d.billing_address),
        billing_city: str(d.billing_city),
        billing_state: str(d.billing_state),
        billing_pin_code: str(d.billing_pin_code),
        credit_terms: d.credit_terms,
        notes: str(d.notes),
      })
      .eq("id", id);

    if (error) return { error: error.message };
    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return { success: true, id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateClientRecord");
  }
}

export async function deleteClientRecord(id: string): Promise<{ error?: string }> {
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

    // Guard: check for active campaigns linked to this client
    // Active = anything not cancelled, completed, or dismounted
    const { count: activeCampaigns } = await ctx.supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .is("deleted_at", null)
      .not("status", "in", '("cancelled","completed","dismounted")');

    if (activeCampaigns && activeCampaigns > 0) {
      return { error: "Cannot delete client with active campaigns" };
    }

    const { error } = await ctx.supabase
      .from("clients")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { error: error.message };
    revalidatePath("/clients");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteClientRecord");
  }
}
