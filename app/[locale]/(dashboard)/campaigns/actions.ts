"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createCampaignSchema, campaignBasicsSchema, campaignSiteEntrySchema,
  draftCampaignSchema, changeRequestSchema, reviewChangeRequestSchema,
} from "@/lib/validations/campaign";
import type { CampaignStatus } from "@/lib/types/database";
import {
  computeCampaignValuePaise,
  initialCampaignDbStatus,
  recomputeCampaignTotalValue,
} from "@/lib/campaigns/derive";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
import { notify } from "@/lib/notifications/dispatch";
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

function n(v: number | undefined | null) { return v != null ? Math.round(v * 100) : null; }
function str(v?: string) { return v?.trim() || null; }

// Persisted status comes from lib/campaigns/derive.ts → initialCampaignDbStatus.
// "Yet to start" is a display-only state derived on read so editing
// dates instantly flips the badge without us writing back to the DB.

// ─── Create campaign (with optional sites + services) ─────────────────────────

export async function createCampaign(values: unknown): Promise<ActionResult> {
  try {
    const parsed = createCampaignSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    // Compute total_value server-side from the actual sites + services
    // so the campaign list never shows ₹0 just because the form forgot
    // to submit a manual total. Bundled mode keeps the user-entered
    // package price (the whole point of bundled pricing).
    const totalValuePaise = computeCampaignValuePaise({
      pricing_type: d.pricing_type,
      sites: d.sites.map((s) => ({
        display_rate_inr: s.display_rate_inr,
        rate_type: s.rate_type ?? "per_month",
        start_date: s.start_date ?? null,
        end_date: s.end_date ?? null,
      })),
      services: d.services.map((s) => ({
        rate_inr: s.rate_inr,
        quantity: s.quantity,
      })),
      manualTotalInr: d.total_value_inr,
    });

    // Insert campaign
    //
    // billing_party_type drives who gets invoiced:
    //   - 'client'                    → invoice the client
    //   - 'agency'                    → invoice the agency; client_id kept as reference only
    //   - 'client_on_behalf_of_agency' → invoice the client + log commission owed to agency
    const { data: campaign, error: campError } = await ctx.supabase
      .from("campaigns")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        campaign_name: d.campaign_name,
        client_id: d.client_id && d.client_id !== "" ? d.client_id : null,
        billing_party_type: d.billing_party_type,
        billed_agency_id:
          d.billed_agency_id && d.billed_agency_id !== ""
            ? d.billed_agency_id
            : null,
        agency_commission_percentage:
          d.billing_party_type === "client_on_behalf_of_agency"
            ? d.agency_commission_percentage ?? null
            : null,
        agency_commission_paise:
          d.billing_party_type === "client_on_behalf_of_agency"
            ? n(d.agency_commission_inr)
            : null,
        start_date: str(d.start_date),
        end_date: str(d.end_date),
        // DB only stores live / completed / cancelled. "Yet to start"
        // is a display-only state derived on read so editing dates
        // instantly flips the badge without a write.
        status: initialCampaignDbStatus(str(d.end_date)),
        pricing_type: d.pricing_type,
        total_value_paise: totalValuePaise,
        notes: str(d.notes),
      })
      .select("id")
      .single();

    if (campError || !campaign) return { error: campError?.message ?? "Failed to create campaign" };

    const campaignId = campaign.id;

    // Insert campaign_sites
    if (d.sites.length > 0) {
      const siteRows = d.sites.map((s) => ({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        site_id: s.site_id,
        rate_type: s.rate_type ?? "fixed",
        display_rate_paise: n(s.display_rate_inr),
        start_date: str(s.start_date),
        end_date: str(s.end_date),
        status: "pending" as const,
      }));
      const { error: sitesError } = await ctx.supabase.from("campaign_sites").insert(siteRows);
      if (sitesError) return { error: sitesError.message };
    }

    // Insert campaign_services.
    //
    // Convention: for per_sqft services the UI auto-fills `quantity`
    // with the linked site's area (width × height in sqft), so the
    // total is simply rate × quantity regardless of rate_basis. No
    // second multiply by site sqft — that would double-count.
    if (d.services.length > 0) {
      const serviceRows = d.services.map((s) => {
        const ratePaise = Math.round(s.rate_inr * 100);
        const totalPaise = Math.round(s.rate_inr * s.quantity * 100);
        return {
          organization_id: ctx.orgId,
          campaign_id: campaignId,
          site_id: s.site_id ?? null,
          service_type: s.service_type,
          description: str(s.description),
          quantity: s.quantity,
          rate_paise: ratePaise,
          total_paise: totalPaise,
          rate_basis: s.rate_basis ?? "lumpsum",
          other_label: str(s.other_label),
        };
      });
      const { error: servicesError } = await ctx.supabase.from("campaign_services").insert(serviceRows);
      if (servicesError) return { error: servicesError.message };
    }

    // Log activity
    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "created",
      description: `Campaign "${d.campaign_name}" created`,
    });

    revalidatePath("/campaigns");
    return { success: true, id: campaignId };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createCampaign");
  }
}

// ─── Update campaign basics ───────────────────────────────────────────────────

export async function updateCampaign(id: string, values: unknown): Promise<ActionResult> {
  try {
    const parsed = campaignBasicsSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;
    const { error } = await ctx.supabase
      .from("campaigns")
      .update({
        updated_by: ctx.user.id,
        campaign_name: d.campaign_name,
        client_id: d.client_id && d.client_id !== "" ? d.client_id : null,
        billing_party_type: d.billing_party_type,
        billed_agency_id:
          d.billed_agency_id && d.billed_agency_id !== ""
            ? d.billed_agency_id
            : null,
        agency_commission_percentage:
          d.billing_party_type === "client_on_behalf_of_agency"
            ? d.agency_commission_percentage ?? null
            : null,
        agency_commission_paise:
          d.billing_party_type === "client_on_behalf_of_agency"
            ? n(d.agency_commission_inr)
            : null,
        start_date: str(d.start_date),
        end_date: str(d.end_date),
        pricing_type: d.pricing_type,
        // Bundled campaigns trust the user-entered package price.
        // Itemized campaigns get their value recomputed from existing
        // sites + services right after this update lands.
        total_value_paise:
          d.pricing_type === "bundled" ? n(d.total_value_inr) : undefined,
        notes: str(d.notes),
      })
      .eq("id", id);

    if (error) return { error: error.message };

    // For itemized campaigns, recompute the total from the actual
    // line-item rows so the displayed value tracks reality.
    if (d.pricing_type === "itemized") {
      await recomputeCampaignTotalValue(ctx.supabase, id);
    }

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: id,
      user_id: ctx.user.id,
      action: "updated",
      description: `Campaign details updated`,
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    return { success: true, id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateCampaign");
  }
}

// ─── Update campaign status (with site status side effects) ───────────────────

export async function updateCampaignStatus(
  campaignId: string,
  newStatus: CampaignStatus
): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Fetch current status
    const { data: current } = await ctx.supabase
      .from("campaigns")
      .select("status, campaign_name")
      .eq("id", campaignId)
      .single();

    if (!current) return { error: "Campaign not found" };

    const { error } = await ctx.supabase
      .from("campaigns")
      .update({ status: newStatus, updated_by: ctx.user.id })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    // Fetch all sites in this campaign
    const { data: campSites } = await ctx.supabase
      .from("campaign_sites")
      .select("site_id")
      .eq("campaign_id", campaignId);

    const siteIds = (campSites ?? []).map((cs) => cs.site_id as string);

    if (siteIds.length > 0) {
      // When campaign goes live → mark all sites as booked.
      if (newStatus === "live") {
        await ctx.supabase
          .from("sites")
          .update({ status: "booked" })
          .in("id", siteIds);
      }

      // When campaign ends → release each site unless another live
      // campaign is still booking it.
      if (newStatus === "completed") {
        const { data: activeCampaigns } = await ctx.supabase
          .from("campaigns")
          .select("id")
          .eq("status", "live")
          .is("deleted_at", null)
          .neq("id", campaignId);

        const activeCampaignIds = (activeCampaigns ?? []).map((c) => c.id as string);

        for (const siteId of siteIds) {
          if (activeCampaignIds.length > 0) {
            const { count } = await ctx.supabase
              .from("campaign_sites")
              .select("id", { count: "exact", head: true })
              .eq("site_id", siteId)
              .in("campaign_id", activeCampaignIds);
            if ((count ?? 0) > 0) continue;
          }
          await ctx.supabase
            .from("sites")
            .update({ status: "available" })
            .eq("id", siteId);
        }
      }
    }

    // Log activity
    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "status_changed",
      description: `Status changed to "${newStatus}"`,
      old_value: current.status,
      new_value: newStatus,
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateCampaignStatus");
  }
}

// ─── Add site to campaign ─────────────────────────────────────────────────────

export async function addCampaignSite(campaignId: string, values: unknown): Promise<{ error?: string }> {
  try {
    const parsed = campaignSiteEntrySchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;
    const { error } = await ctx.supabase
      .from("campaign_sites")
      .insert({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        site_id: d.site_id,
        display_rate_paise: n(d.display_rate_inr),
        start_date: str(d.start_date),
        end_date: str(d.end_date),
        status: "pending",
      });

    if (error) return { error: error.message };

    // Adding a site shifts the campaign value — recompute now so the
    // list view reflects the new total without waiting for an unrelated
    // edit.
    await recomputeCampaignTotalValue(ctx.supabase, campaignId);

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "site_added",
      description: "Site added to campaign",
      new_value: d.site_id,
    });

    revalidatePath(`/campaigns/${campaignId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "addCampaignSite");
  }
}

// ─── Remove site from campaign ────────────────────────────────────────────────

export async function removeCampaignSite(
  campaignSiteId: string,
  campaignId: string
): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const { error } = await ctx.supabase
      .from("campaign_sites")
      .delete()
      .eq("id", campaignSiteId);

    if (error) return { error: error.message };

    // Removing a site shrinks the value — recompute now.
    await recomputeCampaignTotalValue(ctx.supabase, campaignId);

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "site_removed",
      description: "Site removed from campaign",
    });

    revalidatePath(`/campaigns/${campaignId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "removeCampaignSite");
  }
}

// ─── Cancel campaign (available at any stage) ───────────────────────────────

export async function cancelCampaign(campaignId: string): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const { data: current } = await ctx.supabase
      .from("campaigns")
      .select(
        "status, campaign_name, campaign_code, start_date, end_date, client:clients(company_name)",
      )
      .eq("id", campaignId)
      .single();

    if (!current) return { error: "Campaign not found" };
    if (current.status === "cancelled") return { error: "Already cancelled" };

    const { error } = await ctx.supabase
      .from("campaigns")
      .update({ status: "cancelled", updated_by: ctx.user.id })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    // Release booked sites
    const { data: campSites } = await ctx.supabase
      .from("campaign_sites")
      .select("site_id")
      .eq("campaign_id", campaignId);

    // Fetch IDs of other live campaigns so we can tell whether a
    // freshly-cancelled campaign's sites should go back to "available"
    // or stay booked by another concurrent campaign.
    const { data: activeCampaigns } = await ctx.supabase
      .from("campaigns")
      .select("id")
      .eq("status", "live")
      .is("deleted_at", null)
      .neq("id", campaignId);

    const activeCampaignIds = (activeCampaigns ?? []).map((c) => c.id as string);

    for (const cs of campSites ?? []) {
      if (activeCampaignIds.length > 0) {
        const { count } = await ctx.supabase
          .from("campaign_sites")
          .select("id", { count: "exact", head: true })
          .eq("site_id", cs.site_id)
          .in("campaign_id", activeCampaignIds);
        if ((count ?? 0) > 0) continue;
      }
      await ctx.supabase.from("sites").update({ status: "available" }).eq("id", cs.site_id);
    }

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "status_changed",
      description: `Campaign cancelled (was "${current.status}")`,
      old_value: current.status,
      new_value: "cancelled",
    });

    // Postgrest's embedded relation typing returns `client` as either
    // a single object or an array depending on the row's cardinality —
    // narrow it before reading company_name.
    const clientRel = (current as unknown as {
      client: { company_name: string | null } | { company_name: string | null }[] | null;
    }).client;
    const clientName = Array.isArray(clientRel)
      ? clientRel[0]?.company_name ?? null
      : clientRel?.company_name ?? null;

    await notify({
      organizationId: ctx.orgId,
      eventType: "campaign_cancelled",
      entityType: "campaign",
      entityId: campaignId,
      severity: "warning",
      title: `Campaign cancelled — ${current.campaign_name}`,
      message: `${current.campaign_name} for ${clientName ?? "—"} was cancelled (was "${current.status}"). Linked sites have been released.`,
      data: {
        Campaign: current.campaign_name,
        Code: current.campaign_code ?? "—",
        Client: clientName ?? "—",
        "Previous status": current.status,
        "Start date": current.start_date ?? "—",
        "End date": current.end_date ?? "—",
      },
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "cancelCampaign");
  }
}

// ─── Extend campaign dates ──────────────────────────────────────────────────
//
// Extending bumps the campaign end_date AND rescales every linked site
// so the billable amount keeps growing in step with the duration:
//
//   per_month sites — end_date pushed to newEndDate; recompute applies
//                     the standard `rate × days / 30` formula.
//   fixed-price sites — converted to per_month on the spot. The stored
//                     flat rate is reinterpreted as "the amount billed
//                     for the ORIGINAL period" and converted to an
//                     equivalent monthly rate so the extension period
//                     bills at the same per-day rate the client was
//                     already paying. Flipping to per_month is a one-
//                     way migration; subsequent extensions re-scale
//                     via the usual math.
//
// Returns `redirectTo` with a pre-filled invoice URL for the extension
// window so the user can review and send immediately.

export async function extendCampaign(
  campaignId: string,
  newEndDate: string
): Promise<{ error?: string; redirectTo?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const { data: current } = await ctx.supabase
      .from("campaigns")
      .select("end_date, start_date, status, client_id, pricing_type")
      .eq("id", campaignId)
      .single();

    if (!current) return { error: "Campaign not found" };

    // Cancelled campaigns are locked — extending one would silently
    // un-cancel it and resurrect bookings that were intentionally
    // dropped. Force the user to clone instead.
    if (current.status === "cancelled") {
      return {
        error:
          "Cancelled campaigns can't be extended. Create a new campaign with the same sites instead.",
      };
    }

    const oldEndDate = current.end_date as string | null;
    if (oldEndDate && newEndDate <= oldEndDate) {
      return { error: "New end date must be after the current end date." };
    }

    // If we're extending a completed campaign past today, we have to
    // reopen it: DB status flips back to live, and the sites that
    // were released to "available" when it finished need to be
    // re-booked. End dates in the past are accepted (the user is
    // back-filling a historical record) and leave status alone.
    const todayStr = new Date().toISOString().slice(0, 10);
    const reopenAsLive =
      current.status === "completed" && newEndDate >= todayStr;

    const campaignUpdate: { end_date: string; updated_by: string; status?: "live" } = {
      end_date: newEndDate,
      updated_by: ctx.user.id,
    };
    if (reopenAsLive) campaignUpdate.status = "live";

    const { error } = await ctx.supabase
      .from("campaigns")
      .update(campaignUpdate)
      .eq("id", campaignId);

    if (error) return { error: error.message };

    // ── Rescale every linked site to the new end date ─────────────────
    // Previously we only bumped sites whose end_date matched the old
    // campaign end. That left sites with custom shorter end dates
    // out of the extension and under-billed. The user's billing
    // model is "price keeps growing with duration", so bump every
    // site that was ending at or before the old campaign end.
    const { data: csRows } = await ctx.supabase
      .from("campaign_sites")
      .select("id, site_id, start_date, end_date, rate_type, display_rate_paise")
      .eq("campaign_id", campaignId);

    for (const cs of csRows ?? []) {
      const siteStart = cs.start_date as string | null;
      const siteEnd = cs.end_date as string | null;
      const ratePaise = (cs.display_rate_paise as number | null) ?? 0;
      const rateType = (cs.rate_type as string | null) ?? "per_month";

      // Only extend sites whose booking tracks the campaign window
      // (ended at or before the old campaign end). A site that was
      // DELIBERATELY given a shorter range AND an end date earlier
      // than the campaign end is still bumped — the user's intent
      // is "the whole campaign is extended". A later shorter end can
      // be re-set manually per site if needed.
      if (!siteEnd || !siteStart) continue;

      if (rateType === "fixed") {
        // Convert fixed → per_month using the booked period as the
        // reference. Monthly equivalent of a fixed rate for N days:
        //   monthlyPaise = ratePaise × 30 / N
        // This preserves the per-day rate the client was already
        // paying so subsequent extensions bill at the same unit cost.
        const oldDays = daysBetweenInclusive(siteStart, siteEnd);
        if (oldDays <= 0 || !ratePaise) {
          // Nothing meaningful to convert — just bump the end_date.
          await ctx.supabase
            .from("campaign_sites")
            .update({ end_date: newEndDate })
            .eq("id", cs.id);
          continue;
        }
        const monthlyPaise = Math.round((ratePaise * 30) / oldDays);
        await ctx.supabase
          .from("campaign_sites")
          .update({
            end_date: newEndDate,
            rate_type: "per_month",
            display_rate_paise: monthlyPaise,
          })
          .eq("id", cs.id);
      } else {
        // per_month (or unset — defaults to per_month in derive.ts).
        // Just push the end date forward; recompute will scale the
        // amount using the standard formula.
        await ctx.supabase
          .from("campaign_sites")
          .update({ end_date: newEndDate })
          .eq("id", cs.id);
      }
    }

    // When reopening, re-book the linked sites so the inventory map
    // shows them as taken again. Skip sites already booked by another
    // currently-live campaign (they'd otherwise overwrite a different
    // booking's status).
    if (reopenAsLive) {
      const siteIds = (csRows ?? []).map((r) => r.site_id as string);
      for (const siteId of siteIds) {
        await ctx.supabase
          .from("sites")
          .update({ status: "booked" })
          .eq("id", siteId)
          // Don't overwrite a maintenance / blocked / expired state.
          .in("status", ["available", "booked"]);
      }
    }

    // Per-month rates × days math means extending the date range
    // bumps the total. Recompute so the value reflects the new
    // duration immediately.
    await recomputeCampaignTotalValue(ctx.supabase, campaignId);

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "updated",
      description: reopenAsLive
        ? `Campaign reopened and extended to ${newEndDate}`
        : `Campaign extended to ${newEndDate}`,
      old_value: oldEndDate,
      new_value: newEndDate,
    });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);

    // Hand the client a pre-filled invoice URL for the extension
    // window — the invoice form uses these dates to pro-rate each
    // site's rental line. The user still has to review GST / terms
    // and click Save, so this is suggestive, not automatic.
    const clientId = current.client_id as string | null;
    const periodFrom = oldEndDate ? addOneDay(oldEndDate) : current.start_date as string | null;
    const redirectTo =
      clientId && periodFrom
        ? `/billing/invoices/new?campaign_id=${encodeURIComponent(campaignId)}&client_id=${encodeURIComponent(clientId)}&period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(newEndDate)}`
        : undefined;

    return redirectTo ? { redirectTo } : {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "extendCampaign");
  }
}

// Inclusive day count helper. Lives next to extendCampaign so the
// pro-rata math and the extension logic can't drift apart.
function daysBetweenInclusive(fromStr: string, toStr: string): number {
  const from = new Date(fromStr).getTime();
  const to = new Date(toStr).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1);
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Save campaign as draft (lenient validation) ────────────────────────────

export async function saveCampaignDraft(values: unknown): Promise<ActionResult> {
  try {
    const parsed = draftCampaignSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    const d = parsed.data;

    // Drafts also auto-compute their value so the list view shows a
    // sensible figure the moment a draft has any line items, instead
    // of ₹0 until the user fills the manual total.
    const draftPricingType = d.pricing_type ?? "itemized";
    const totalValuePaise = computeCampaignValuePaise({
      pricing_type: draftPricingType,
      sites: (d.sites ?? []).map((s) => ({
        display_rate_inr: s.display_rate_inr,
        rate_type: s.rate_type ?? "per_month",
        start_date: s.start_date ?? null,
        end_date: s.end_date ?? null,
      })),
      services: (d.services ?? []).map((s) => ({
        rate_inr: s.rate_inr,
        quantity: s.quantity,
      })),
      manualTotalInr: d.total_value_inr,
    });

    const { data: campaign, error: campError } = await ctx.supabase
      .from("campaigns")
      .insert({
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
        campaign_name: d.campaign_name,
        client_id: d.client_id && d.client_id !== "" ? d.client_id : null,
        billing_party_type: d.billing_party_type ?? "client",
        billed_agency_id:
          d.billed_agency_id && d.billed_agency_id !== ""
            ? d.billed_agency_id
            : null,
        agency_commission_percentage:
          d.billing_party_type === "client_on_behalf_of_agency"
            ? d.agency_commission_percentage ?? null
            : null,
        agency_commission_paise:
          d.billing_party_type === "client_on_behalf_of_agency"
            ? n(d.agency_commission_inr)
            : null,
        start_date: str(d.start_date),
        end_date: str(d.end_date),
        // Drafts and real creates share the same live/completed derivation
        // — drafts are just partial entries, but once saved they behave
        // like any other live campaign.
        status: initialCampaignDbStatus(str(d.end_date)),
        pricing_type: draftPricingType,
        total_value_paise: totalValuePaise,
        notes: str(d.notes),
      })
      .select("id")
      .single();

    if (campError || !campaign) return { error: campError?.message ?? "Failed to save draft" };

    const campaignId = campaign.id;

    // Insert any sites added so far
    if (d.sites && d.sites.length > 0) {
      const siteRows = d.sites.map((s) => ({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        site_id: s.site_id,
        rate_type: s.rate_type ?? "fixed",
        display_rate_paise: n(s.display_rate_inr),
        start_date: str(s.start_date),
        end_date: str(s.end_date),
        status: "pending" as const,
      }));
      await ctx.supabase.from("campaign_sites").insert(siteRows);
    }

    // Insert any services added so far. Same convention as createCampaign:
    // for per_sqft, quantity already holds the site area, so total is
    // rate × quantity — no second multiply by site sqft.
    if (d.services && d.services.length > 0) {
      const serviceRows = d.services.map((s) => ({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        site_id: s.site_id ?? null,
        service_type: s.service_type,
        description: str(s.description),
        quantity: s.quantity,
        rate_paise: Math.round(s.rate_inr * 100),
        total_paise: Math.round(s.rate_inr * s.quantity * 100),
        rate_basis: s.rate_basis ?? "lumpsum",
        other_label: str(s.other_label),
      }));
      await ctx.supabase.from("campaign_services").insert(serviceRows);
    }

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "created",
      description: `Draft campaign "${d.campaign_name}" saved`,
    });

    revalidatePath("/campaigns");
    return { success: true, id: campaignId };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "saveCampaignDraft");
  }
}

// ─── Change request: request changes to confirmed+ campaign ─────────────────

export async function createChangeRequest(
  campaignId: string,
  values: unknown
): Promise<{ error?: string }> {
  try {
    const parsed = changeRequestSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Verify campaign exists and is in a locked status
    const { data: campaign } = await ctx.supabase
      .from("campaigns")
      .select("status, campaign_name")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign not found" };

    // Only live campaigns accept change requests. Completed /
    // cancelled are terminal and shouldn't be modified through the
    // approval workflow.
    if (campaign.status !== "live") {
      return {
        error: `Cannot request changes on a ${campaign.status} campaign`,
      };
    }

    // Check for existing pending request
    const { count } = await ctx.supabase
      .from("campaign_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    if ((count ?? 0) > 0) {
      return { error: "A change request is already pending for this campaign" };
    }

    const { error } = await ctx.supabase
      .from("campaign_change_requests")
      .insert({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        requested_by: ctx.user.id,
        status: "pending",
        reason: parsed.data.reason,
        requested_at: new Date().toISOString(),
      });

    if (error) return { error: error.message };

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "change_requested",
      description: `Change request: ${parsed.data.reason}`,
    });

    revalidatePath(`/campaigns/${campaignId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createChangeRequest");
  }
}

// ─── Review change request (approve/reject) ─────────────────────────────────

export async function reviewChangeRequest(
  requestId: string,
  values: unknown
): Promise<{ error?: string }> {
  try {
    const parsed = reviewChangeRequestSchema.safeParse(values);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Verify user role (admin/executive). Checks roles[] first (multi-role
    // users), falling back to the primary role column.
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("role, roles")
      .eq("id", ctx.user.id)
      .single();

    const allowed = ["super_admin", "admin", "manager", "executive"];
    const userRoles: string[] =
      Array.isArray((profile as { roles?: string[] } | null)?.roles) &&
      ((profile as { roles?: string[] } | null)?.roles?.length ?? 0) > 0
        ? ((profile as { roles?: string[] }).roles as string[])
        : profile?.role
          ? [profile.role]
          : [];

    if (!profile || !userRoles.some((r) => allowed.includes(r))) {
      return { error: "Only admins, managers and executives can review change requests" };
    }

    // Fetch the request
    const { data: request } = await ctx.supabase
      .from("campaign_change_requests")
      .select("campaign_id, status")
      .eq("id", requestId)
      .single();

    if (!request) return { error: "Change request not found" };
    if (request.status !== "pending") return { error: "Request already reviewed" };

    const d = parsed.data;
    const now = new Date().toISOString();

    // Update request
    const { error } = await ctx.supabase
      .from("campaign_change_requests")
      .update({
        status: d.status,
        reviewed_by: ctx.user.id,
        reviewed_at: now,
        rejection_reason: d.status === "rejected" ? (d.rejection_reason ?? null) : null,
      })
      .eq("id", requestId);

    if (error) return { error: error.message };

    const campaignId = request.campaign_id;

    if (d.status === "approved") {
      // With the simplified status model there's no status to revert
      // to — the campaign stays "live" and the request approval is
      // itself the signal that edits are allowed. Just log the event.
      await ctx.supabase.from("campaign_activity_log").insert({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        user_id: ctx.user.id,
        action: "change_approved",
        description: "Change request approved — campaign remains live for editing",
      });
    } else {
      await ctx.supabase.from("campaign_activity_log").insert({
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        user_id: ctx.user.id,
        action: "change_rejected",
        description: `Change request rejected${d.rejection_reason ? `: ${d.rejection_reason}` : ""}`,
      });
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "reviewChangeRequest");
  }
}

// ─── Delete campaign (soft delete) ───────────────────────────────────────────

export async function deleteCampaign(id: string): Promise<{ error?: string }> {
  try {
    const ctx = await getOrgAndUser();
    if (!ctx) return { error: "Not authenticated" };

    // Soft-delete via SECURITY DEFINER RPC (migration 036). We can't
    // do the UPDATE from the authenticated role because Postgres
    // applies the SELECT RLS policy to the RETURNING rows, and the
    // SELECT policy requires `deleted_at IS NULL` — so a direct
    // UPDATE that sets deleted_at flips the row out of visibility
    // and raises "new row violates row-level security policy". The
    // RPC runs as definer, validates org + role in SQL, performs
    // the soft-delete, and logs the audit entry in one transaction.
    const { error } = await ctx.supabase.rpc("soft_delete_campaign", {
      p_id: id,
    });
    if (error) return { error: error.message };

    revalidatePath("/campaigns");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteCampaign");
  }
}
