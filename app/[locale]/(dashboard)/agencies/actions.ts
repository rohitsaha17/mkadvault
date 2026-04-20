"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { agencySchema } from "@/lib/validations/agency";

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

export async function createAgency(values: unknown): Promise<ActionResult> {
  const parsed = agencySchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const { data, error } = await ctx.supabase
    .from("partner_agencies")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
      agency_name: d.agency_name,
      contact_person: str(d.contact_person),
      phone: str(d.phone),
      email: str(d.email),
      gstin: str(d.gstin),
      address: str(d.address),
      city: str(d.city),
      state: str(d.state),
      notes: str(d.notes),
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/agencies");
  return { success: true, id: data.id };
}

export async function updateAgency(id: string, values: unknown): Promise<ActionResult> {
  const parsed = agencySchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const { error } = await ctx.supabase
    .from("partner_agencies")
    .update({
      updated_by: ctx.user.id,
      agency_name: d.agency_name,
      contact_person: str(d.contact_person),
      phone: str(d.phone),
      email: str(d.email),
      gstin: str(d.gstin),
      address: str(d.address),
      city: str(d.city),
      state: str(d.state),
      notes: str(d.notes),
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/agencies");
  revalidatePath(`/agencies/${id}`);
  return { success: true, id };
}

export async function deleteAgency(id: string): Promise<{ error?: string }> {
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

  // Guard: check for active contracts linked to this agency
  const { count: activeContracts } = await ctx.supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("counterparty_id", id)
    .eq("status", "active")
    .is("deleted_at", null);

  if (activeContracts && activeContracts > 0) {
    return { error: "Cannot delete agency with active contracts" };
  }

  const { error } = await ctx.supabase
    .from("partner_agencies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/agencies");
  return {};
}
