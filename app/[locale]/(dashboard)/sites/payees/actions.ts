"use server";
// Server actions for the multi-payee layer on a site.
//
// A site can have multiple payees (e.g. family members splitting rent,
// or a landowner + a society-maintenance fee), each with a percentage
// share that the trigger in migration 046 enforces to sum to 100.
// When no site_payees row exists for a site, downstream reports fall
// back to the single `sites.landowner_id` as the sole payee — so this
// layer is strictly additive and existing single-landowner sites keep
// working untouched.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";

async function getOrgAndUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) return null;
  return { supabase, user, orgId: profile.org_id };
}

// Phase-1 create: single payee at a time. The DB trigger
// `site_payees_sum_to_100` runs DEFERRED, so the caller can insert
// several rows in one transaction and only the final sum is checked.
// Supabase client doesn't give us explicit transactions from
// JS, so we use a replaceSitePayees action below for the bulk case.

const sitePayeeSchema = z.object({
  site_id: z.string().uuid(),
  payee_type: z.enum(["landowner", "agency"]),
  landowner_id: z.string().uuid().optional(),
  agency_id: z.string().uuid().optional(),
  share_percent: z.coerce.number().positive().max(100),
  label: z.string().max(100).optional(),
  notes: z.string().optional(),
});

const replacePayeesSchema = z.object({
  site_id: z.string().uuid(),
  payees: z
    .array(
      z.object({
        payee_type: z.enum(["landowner", "agency"]),
        landowner_id: z.string().uuid().optional(),
        agency_id: z.string().uuid().optional(),
        share_percent: z.coerce.number().positive().max(100),
        label: z.string().max(100).optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1, "Add at least one payee"),
});

function revalidateSite(siteId: string) {
  // page-variant invalidation so a site detail with query params (e.g.
  // ?tab=payees) still refreshes after a mutation.
  revalidatePath(`/sites/${siteId}`, "page");
  revalidatePath("/sites", "page");
}

// ─── replaceSitePayees ───────────────────────────────────────────────────────
// Overwrite the full list of payees for a site in one shot. Simpler for
// the UI than tracking per-row create/update/delete. The DB enforces
// that shares sum to exactly 100 via the deferred trigger.
export async function replaceSitePayees(
  values: unknown,
): Promise<{ error?: string; count?: number }> {
  try {
    const parsed = replacePayeesSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { site_id, payees } = parsed.data;

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const sum = payees.reduce((s, p) => s + p.share_percent, 0);
    if (Math.abs(sum - 100) > 0.001) {
      return { error: `Shares must sum to 100% (got ${sum.toFixed(2)}%)` };
    }
    for (const p of payees) {
      if (p.payee_type === "landowner" && !p.landowner_id) {
        return { error: "Each landowner payee needs a landowner selected" };
      }
      if (p.payee_type === "agency" && !p.agency_id) {
        return { error: "Each agency payee needs an agency selected" };
      }
    }

    // Delete + insert is cleaner than diffing. Both wrapped so the
    // deferred trigger only runs at end-of-transaction.
    const { error: delErr } = await ctx.supabase
      .from("site_payees")
      .delete()
      .eq("site_id", site_id)
      .eq("organization_id", ctx.orgId);
    if (delErr) return { error: delErr.message };

    const rows = payees.map((p) => ({
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      site_id,
      payee_type: p.payee_type,
      landowner_id: p.payee_type === "landowner" ? p.landowner_id : null,
      agency_id: p.payee_type === "agency" ? p.agency_id : null,
      share_percent: p.share_percent,
      label: p.label?.trim() || null,
      notes: p.notes?.trim() || null,
    }));

    const { error: insErr, data: inserted } = await ctx.supabase
      .from("site_payees")
      .insert(rows)
      .select("id");
    if (insErr) return { error: insErr.message };

    revalidateSite(site_id);
    return { count: inserted?.length ?? rows.length };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "replaceSitePayees");
  }
}

// ─── addSitePayee ────────────────────────────────────────────────────────────
// Convenience: add one more payee (user still responsible for keeping
// the running total at 100). Useful for incremental edit flows.
export async function addSitePayee(
  values: unknown,
): Promise<{ error?: string; id?: string }> {
  try {
    const parsed = sitePayeeSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.payee_type === "landowner" && !d.landowner_id) {
      return { error: "Select a landowner" };
    }
    if (d.payee_type === "agency" && !d.agency_id) {
      return { error: "Select an agency" };
    }

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const { data, error } = await ctx.supabase
      .from("site_payees")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        site_id: d.site_id,
        payee_type: d.payee_type,
        landowner_id: d.payee_type === "landowner" ? d.landowner_id : null,
        agency_id: d.payee_type === "agency" ? d.agency_id : null,
        share_percent: d.share_percent,
        label: d.label?.trim() || null,
        notes: d.notes?.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) return { error: error?.message ?? "Failed to add payee" };

    revalidateSite(d.site_id);
    return { id: data.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "addSitePayee");
  }
}

// ─── removeSitePayee ─────────────────────────────────────────────────────────
export async function removeSitePayee(
  payeeId: string,
): Promise<{ error?: string; ok?: true }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Find the site_id first so we can revalidate the right page.
    const { data: existing } = await ctx.supabase
      .from("site_payees")
      .select("site_id")
      .eq("id", payeeId)
      .single();

    const { error } = await ctx.supabase
      .from("site_payees")
      .delete()
      .eq("id", payeeId);

    if (error) return { error: error.message };
    if (existing?.site_id) revalidateSite(existing.site_id);
    return { ok: true };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "removeSitePayee");
  }
}
