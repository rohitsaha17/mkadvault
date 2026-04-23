// Auto-complete campaigns whose end_date has passed.
// Called from:
//  1. Vercel cron job (daily, uses admin client — bypasses RLS to process all orgs)
//  2. Dashboard page load (uses server client — scoped to current user's org via RLS)
//
// Logic:
//  - Find campaigns in active statuses whose end_date < today
//  - Update their status to "completed"
//  - Free up linked sites (set to "available" if no other active campaign uses them)

import type { SupabaseClient } from "@supabase/supabase-js";

// With the simplified status model (migration 035), "live" is the
// only non-terminal state — so both COMPLETABLE_STATUSES and
// ACTIVE_CAMPAIGN_STATUSES collapse to that single value.
const COMPLETABLE_STATUSES = ["live"] as const;
const ACTIVE_CAMPAIGN_STATUSES = ["live"];

interface AutoCompleteResult {
  completed: number;
  sitesFreed: number;
  sitesBooked: number;
  errors: string[];
}

/**
 * Find and complete campaigns whose end_date has passed.
 * Works with any Supabase client (admin for cron, regular for dashboard load).
 */
export async function autoCompletePastDueCampaigns(
  supabase: SupabaseClient
): Promise<AutoCompleteResult> {
  const result: AutoCompleteResult = {
    completed: 0,
    sitesFreed: 0,
    sitesBooked: 0,
    errors: [],
  };

  // Today at midnight IST (UTC+5:30) — campaigns ending today are still active,
  // only complete campaigns whose end_date is strictly before today.
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Fetch campaigns that should be auto-completed
  const { data: expiredCampaigns, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, organization_id, campaign_name, end_date")
    .in("status", COMPLETABLE_STATUSES as unknown as string[])
    .lt("end_date", today)
    .is("deleted_at", null)
    .limit(200); // safety cap

  if (fetchError) {
    result.errors.push(`Fetch error: ${fetchError.message}`);
    return result;
  }

  if (!expiredCampaigns || expiredCampaigns.length === 0) {
    // Even if nothing completed, still sync site statuses — a confirmed
    // campaign whose start_date just arrived, or a stored 'booked' status
    // that's gone stale, will be corrected below.
    const sync = await syncSiteStatuses(supabase);
    result.sitesBooked += sync.booked;
    result.sitesFreed += sync.freed;
    if (sync.error) result.errors.push(sync.error);
    return result;
  }

  console.log(
    `[auto-complete] Found ${expiredCampaigns.length} expired campaign(s)`
  );

  for (const campaign of expiredCampaigns) {
    try {
      // 1. Update campaign status to "completed"
      const { error: updateError } = await supabase
        .from("campaigns")
        .update({ status: "completed" })
        .eq("id", campaign.id);

      if (updateError) {
        result.errors.push(
          `Failed to complete "${campaign.campaign_name}": ${updateError.message}`
        );
        continue;
      }

      result.completed++;

      // 2. Log activity (best-effort, don't fail if this errors)
      await supabase.from("campaign_activity_log").insert({
        organization_id: campaign.organization_id,
        campaign_id: campaign.id,
        user_id: null, // system action — no user
        action: "status_changed",
        description: `Auto-completed: end date (${campaign.end_date}) has passed`,
        old_value: null, // unknown — could be any completable status
        new_value: "completed",
      }).then(() => {}, () => {}); // swallow errors

      // 3. Free up linked sites if no other active campaign uses them
      const { data: campSites } = await supabase
        .from("campaign_sites")
        .select("site_id")
        .eq("campaign_id", campaign.id);

      const siteIds = (campSites ?? []).map(
        (cs) => cs.site_id as string
      );

      // Fetch IDs of other active campaigns (2-step to avoid broken sub-select)
      const { data: activeCampaigns } = await supabase
        .from("campaigns")
        .select("id")
        .in("status", ACTIVE_CAMPAIGN_STATUSES as unknown as string[])
        .is("deleted_at", null)
        .neq("id", campaign.id);

      const activeCampaignIds = (activeCampaigns ?? []).map((c) => c.id as string);

      for (const siteId of siteIds) {
        if (activeCampaignIds.length > 0) {
          const { count } = await supabase
            .from("campaign_sites")
            .select("id", { count: "exact", head: true })
            .eq("site_id", siteId)
            .in("campaign_id", activeCampaignIds);

          if ((count ?? 0) > 0) continue;
        }

        await supabase
          .from("sites")
          .update({ status: "available" })
          .eq("id", siteId);
        result.sitesFreed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(
        `Exception processing "${campaign.campaign_name}": ${msg}`
      );
    }
  }

  // Final sync pass — covers two cases the per-campaign loop above doesn't:
  //   1. A campaign that's already in an active status (confirmed / mounted /
  //      live) but its site is still stored as 'available'. This happens when
  //      campaigns are inserted directly (bulk import) or created before
  //      today but go active later.
  //   2. A site marked 'booked' whose last live campaign was cancelled /
  //      deleted and no other live campaign overlaps today.
  const sync = await syncSiteStatuses(supabase);
  result.sitesBooked += sync.booked;
  result.sitesFreed += sync.freed;
  if (sync.error) result.errors.push(sync.error);

  return result;
}

/**
 * Reconciles sites.status against the campaign_sites that cover TODAY.
 *
 * A site is 'booked' right now iff there exists a campaign_site where:
 *   - start_date <= today <= end_date
 *   - parent campaign is not deleted AND status is in ACTIVE_CAMPAIGN_STATUSES
 *
 * Called after auto-complete inside autoCompletePastDueCampaigns, and can be
 * invoked directly if the caller just wants to re-sync.
 *
 * Leaves 'maintenance' and 'blocked' statuses alone — those are explicit
 * admin overrides and must not be clobbered by automatic sync.
 */
export async function syncSiteStatuses(
  supabase: SupabaseClient,
): Promise<{ booked: number; freed: number; error?: string }> {
  const today = new Date().toISOString().split("T")[0];

  // Pull campaign_sites that cover today, with parent campaign status.
  const { data: overlapping, error: fetchErr } = await supabase
    .from("campaign_sites")
    .select("site_id, campaign:campaigns(status, deleted_at)")
    .lte("start_date", today)
    .gte("end_date", today);

  if (fetchErr) {
    return { booked: 0, freed: 0, error: fetchErr.message };
  }

  // Supabase's JS types render a to-one relation as an array; normalise
  // either shape to a single object.
  type CampaignRef = { status: string; deleted_at: string | null } | null;
  const normaliseCampaign = (raw: unknown): CampaignRef => {
    if (!raw) return null;
    const obj = Array.isArray(raw) ? raw[0] : raw;
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    return {
      status: typeof o.status === "string" ? o.status : "",
      deleted_at:
        typeof o.deleted_at === "string" ? o.deleted_at : (o.deleted_at as null),
    };
  };

  const shouldBeBooked = new Set<string>();
  for (const row of overlapping ?? []) {
    const camp = normaliseCampaign(
      (row as { campaign?: unknown }).campaign,
    );
    if (!camp || camp.deleted_at) continue;
    if (ACTIVE_CAMPAIGN_STATUSES.includes(camp.status)) {
      shouldBeBooked.add(row.site_id as string);
    }
  }

  // Book sites that should be booked but aren't — only flip from 'available'
  // or 'expired' (don't touch manual maintenance/blocked/deleted).
  let booked = 0;
  if (shouldBeBooked.size > 0) {
    const { data: flipped, error: bookErr } = await supabase
      .from("sites")
      .update({ status: "booked" })
      .in("id", Array.from(shouldBeBooked))
      .in("status", ["available", "expired"])
      .is("deleted_at", null)
      .select("id");
    if (bookErr) return { booked: 0, freed: 0, error: bookErr.message };
    booked = (flipped ?? []).length;
  }

  // Free sites that are stored as 'booked' but no longer have a live
  // campaign overlapping today.
  const { data: currentlyBooked } = await supabase
    .from("sites")
    .select("id")
    .eq("status", "booked")
    .is("deleted_at", null);

  const toFree = (currentlyBooked ?? [])
    .map((s) => s.id as string)
    .filter((id) => !shouldBeBooked.has(id));

  let freed = 0;
  if (toFree.length > 0) {
    const { data: freedRows, error: freeErr } = await supabase
      .from("sites")
      .update({ status: "available" })
      .in("id", toFree)
      .select("id");
    if (freeErr) return { booked, freed: 0, error: freeErr.message };
    freed = (freedRows ?? []).length;
  }

  return { booked, freed };
}
