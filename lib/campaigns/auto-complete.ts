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

// Campaign statuses that are considered "active" and should auto-complete
const COMPLETABLE_STATUSES = [
  "confirmed",
  "creative_received",
  "printing",
  "mounted",
  "live",
] as const;

// Statuses that count as "active" when checking if a site is still in use
const ACTIVE_CAMPAIGN_STATUSES = [
  "confirmed",
  "creative_received",
  "printing",
  "mounted",
  "live",
];

interface AutoCompleteResult {
  completed: number;
  sitesFreed: number;
  errors: string[];
}

/**
 * Find and complete campaigns whose end_date has passed.
 * Works with any Supabase client (admin for cron, regular for dashboard load).
 */
export async function autoCompletePastDueCampaigns(
  supabase: SupabaseClient
): Promise<AutoCompleteResult> {
  const result: AutoCompleteResult = { completed: 0, sitesFreed: 0, errors: [] };

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
    return result; // nothing to do
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

  return result;
}
