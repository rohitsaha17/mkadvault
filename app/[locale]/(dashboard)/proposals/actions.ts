"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { ProposalStatus } from "@/lib/types/database";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getCtx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!profile?.org_id) return null;
  return { supabase, user, orgId: profile.org_id as string };
}

function str(v?: string | null) { return v?.trim() || null; }

// ─── Schemas ─────────────────────────────────────────────────────────────────

const proposalSiteSchema = z.object({
  site_id: z.string().uuid(),
  custom_rate_paise: z.number().nullable().optional(),
  custom_notes: z.string().optional(),
  display_order: z.number().int().default(0),
});

const proposalSchema = z.object({
  proposal_name: z.string().min(1, "Proposal name required"),
  client_id: z.string().uuid().optional(),
  template_type: z.enum(["grid", "list", "one_per_page", "compact"]),
  show_rates: z.enum(["exact", "range", "request_quote", "hidden"]),
  show_photos: z.boolean(),
  show_map: z.boolean(),
  show_dimensions: z.boolean(),
  show_illumination: z.boolean(),
  show_traffic_info: z.boolean(),
  show_availability: z.boolean(),
  include_company_branding: z.boolean(),
  include_terms: z.boolean(),
  terms_text: z.string().optional(),
  include_contact_details: z.boolean(),
  custom_header_text: z.string().optional(),
  custom_footer_text: z.string().optional(),
  notes: z.string().optional(),
  sites: z.array(proposalSiteSchema).min(1, "Select at least one site"),
});


// ─── Create Proposal ─────────────────────────────────────────────────────────

export async function createProposal(values: unknown): Promise<{ error: string } | { id: string }> {
  try {
    const parsed = proposalSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getCtx();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    const { data: proposal, error: propErr } = await ctx.supabase
      .from("proposals")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        proposal_name: d.proposal_name,
        client_id: d.client_id ?? null,
        template_type: d.template_type,
        show_rates: d.show_rates,
        show_photos: d.show_photos,
        show_map: d.show_map,
        show_dimensions: d.show_dimensions,
        show_illumination: d.show_illumination,
        show_traffic_info: d.show_traffic_info,
        show_availability: d.show_availability,
        include_company_branding: d.include_company_branding,
        include_terms: d.include_terms,
        terms_text: str(d.terms_text),
        include_contact_details: d.include_contact_details,
        custom_header_text: str(d.custom_header_text),
        custom_footer_text: str(d.custom_footer_text),
        notes: str(d.notes),
        status: "draft" as ProposalStatus,
      })
      .select("id")
      .single();

    if (propErr || !proposal) return { error: propErr?.message ?? "Failed to create proposal" };

    const siteRows = d.sites.map((s) => ({
      organization_id: ctx.orgId,
      proposal_id: proposal.id,
      site_id: s.site_id,
      custom_rate_paise: s.custom_rate_paise ?? null,
      custom_notes: str(s.custom_notes),
      display_order: s.display_order,
    }));

    const { error: sitesErr } = await ctx.supabase.from("proposal_sites").insert(siteRows);
    if (sitesErr) return { error: sitesErr.message };

    revalidatePath("/proposals");
    return { id: proposal.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createProposal");
  }
}

// ─── Update Proposal ─────────────────────────────────────────────────────────

export async function updateProposal(id: string, values: unknown): Promise<{ error?: string }> {
  try {
    const parsed = proposalSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getCtx();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    const { error: propErr } = await ctx.supabase
      .from("proposals")
      .update({
        updated_by: ctx.user.id,
        proposal_name: d.proposal_name,
        client_id: d.client_id ?? null,
        template_type: d.template_type,
        show_rates: d.show_rates,
        show_photos: d.show_photos,
        show_map: d.show_map,
        show_dimensions: d.show_dimensions,
        show_illumination: d.show_illumination,
        show_traffic_info: d.show_traffic_info,
        show_availability: d.show_availability,
        include_company_branding: d.include_company_branding,
        include_terms: d.include_terms,
        terms_text: str(d.terms_text),
        include_contact_details: d.include_contact_details,
        custom_header_text: str(d.custom_header_text),
        custom_footer_text: str(d.custom_footer_text),
        notes: str(d.notes),
      })
      .eq("id", id);

    if (propErr) return { error: propErr.message };

    // Replace all proposal sites
    await ctx.supabase.from("proposal_sites").delete().eq("proposal_id", id);

    const siteRows = d.sites.map((s) => ({
      organization_id: ctx.orgId,
      proposal_id: id,
      site_id: s.site_id,
      custom_rate_paise: s.custom_rate_paise ?? null,
      custom_notes: str(s.custom_notes),
      display_order: s.display_order,
    }));

    const { error: sitesErr } = await ctx.supabase.from("proposal_sites").insert(siteRows);
    if (sitesErr) return { error: sitesErr.message };

    revalidatePath("/proposals");
    revalidatePath(`/proposals/${id}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateProposal");
  }
}

// ─── Delete Proposal (soft) ──────────────────────────────────────────────────

export async function deleteProposal(id: string): Promise<{ error?: string }> {
  try {
    const ctx = await getCtx();
    if (!ctx) return { error: "Not authenticated" };

    const { error } = await ctx.supabase
      .from("proposals")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { error: error.message };
    revalidatePath("/proposals");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteProposal");
  }
}

// ─── Duplicate Proposal ──────────────────────────────────────────────────────

export async function duplicateProposal(id: string): Promise<{ error?: string; id?: string }> {
  try {
    const ctx = await getCtx();
    if (!ctx) return { error: "Not authenticated" };

    const { data: original } = await ctx.supabase
      .from("proposals")
      .select("*")
      .eq("id", id)
      .single();

    if (!original) return { error: "Proposal not found" };

    const { data: sites } = await ctx.supabase
      .from("proposal_sites")
      .select("site_id, custom_rate_paise, custom_notes, display_order")
      .eq("proposal_id", id);

    const { data: copy, error: copyErr } = await ctx.supabase
      .from("proposals")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        proposal_name: `${original.proposal_name} (Copy)`,
        client_id: original.client_id,
        template_type: original.template_type,
        show_rates: original.show_rates,
        show_photos: original.show_photos,
        show_map: original.show_map,
        show_dimensions: original.show_dimensions,
        show_illumination: original.show_illumination,
        show_traffic_info: original.show_traffic_info,
        show_availability: original.show_availability,
        include_company_branding: original.include_company_branding,
        include_terms: original.include_terms,
        terms_text: original.terms_text,
        include_contact_details: original.include_contact_details,
        custom_header_text: original.custom_header_text,
        custom_footer_text: original.custom_footer_text,
        notes: original.notes,
        status: "draft" as ProposalStatus,
      })
      .select("id")
      .single();

    if (copyErr || !copy) return { error: copyErr?.message ?? "Failed to duplicate" };

    if (sites && sites.length > 0) {
      await ctx.supabase.from("proposal_sites").insert(
        sites.map((s) => ({
          organization_id: ctx.orgId,
          proposal_id: copy.id,
          site_id: s.site_id,
          custom_rate_paise: s.custom_rate_paise,
          custom_notes: s.custom_notes,
          display_order: s.display_order,
        }))
      );
    }

    revalidatePath("/proposals");
    return { id: copy.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "duplicateProposal");
  }
}

// ─── Org-wide T&C template ───────────────────────────────────────────────────
// Save the current textarea contents as this organization's default terms.
// Next time someone opens the wizard with a blank terms_text, we pre-fill
// from this column. Set to null/empty to clear the template.

export async function saveOrgProposalTermsTemplate(
  termsText: string,
): Promise<{ error?: string }> {
  try {
    const ctx = await getCtx();
    if (!ctx) return { error: "Not authenticated" };

    const trimmed = termsText.trim();
    const { error } = await ctx.supabase
      .from("organizations")
      .update({ proposal_terms_template: trimmed === "" ? null : trimmed })
      .eq("id", ctx.orgId);

    if (error) return { error: error.message };
    // Any page that reads the template (proposal new/edit + settings)
    // should see the new default on next render.
    revalidatePath("/proposals");
    revalidatePath("/settings");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "saveOrgProposalTermsTemplate");
  }
}

// ─── Update Status ────────────────────────────────────────────────────────────

export async function updateProposalStatus(id: string, status: ProposalStatus): Promise<{ error?: string }> {
  try {
    const ctx = await getCtx();
    if (!ctx) return { error: "Not authenticated" };

    const { error } = await ctx.supabase
      .from("proposals")
      .update({ status, updated_by: ctx.user.id })
      .eq("id", id);

    if (error) return { error: error.message };
    revalidatePath("/proposals");
    revalidatePath(`/proposals/${id}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateProposalStatus");
  }
}
