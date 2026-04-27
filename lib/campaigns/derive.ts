// Pure helpers for campaign value + status — used by the server
// actions when persisting and the list/detail pages when displaying.
//
// We keep these out of the actions file so the same math runs:
//   • on `createCampaign` and `updateCampaign` (server, write path)
//   • on the list / detail pages (server, read path) for status
//   • inside the campaign form (client, live preview) — same algebra
//     as what the server will record on submit
//
// Behaviour:
//   • Status is derived from start_date / end_date relative to "today"
//     unless the campaign has been manually cancelled (which always
//     wins). The DB column `status` only stores live / completed /
//     cancelled — "yet_to_start" is purely a display status because
//     the campaign would still ship as "live" once the start_date
//     arrives, so persisting it would just create needless writes.
//   • Value is computed from per-site rates × duration + service
//     totals on itemized campaigns. Bundled campaigns trust the user-
//     entered package price.

import type { CampaignStatus } from "@/lib/types/database";

// Display-only status. The DB still stores "live" / "completed" /
// "cancelled" — the "yet_to_start" variant is computed on read so
// the UI can distinguish a campaign whose start_date is still in
// the future from one that's already running.
export type DisplayCampaignStatus = CampaignStatus | "yet_to_start";

export interface CampaignDateInfo {
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Returns the status the UI should render for a campaign given today's
 * date. Manual cancellation always wins; anything else is derived
 * purely from start_date / end_date so editing dates instantly flips
 * the badge without needing a status update.
 *
 * Pass an explicit `now` from tests; defaults to "today" at midnight
 * IST so the same behaviour reproduces from any environment.
 */
export function deriveCampaignStatus(
  campaign: CampaignDateInfo,
  now: Date = new Date(),
): DisplayCampaignStatus {
  // Manual override — never auto-flip a cancelled campaign.
  if (campaign.status === "cancelled") return "cancelled";

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (campaign.start_date) {
    const start = new Date(campaign.start_date);
    if (start > today) return "yet_to_start";
  }
  if (campaign.end_date) {
    const end = new Date(campaign.end_date);
    if (end < today) return "completed";
  }
  return "live";
}

/**
 * Initial status to persist on a brand-new campaign. Mirrors the
 * derived display status but limited to values the DB knows about
 * (live / completed). Mostly returns "live"; only flips to
 * "completed" when the user is back-filling a booking that has
 * already ended (legitimate use case for historical reporting).
 */
export function initialCampaignDbStatus(
  endDate: string | null,
  now: Date = new Date(),
): CampaignStatus {
  if (!endDate) return "live";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  return end < today ? "completed" : "live";
}

// ─── Value math ───────────────────────────────────────────────────────────

export type SiteRateType = "per_month" | "fixed";

export interface CampaignSiteRateInput {
  display_rate_inr: number | null | undefined;
  rate_type: SiteRateType | string | null | undefined;
  start_date: string | null | undefined;
  end_date: string | null | undefined;
}

export interface CampaignServiceRateInput {
  rate_inr: number | null | undefined;
  quantity: number | null | undefined;
}

/**
 * Per-site total in paise. For per_month bookings: rate × days / 30
 * (industry-standard pro-rata rule). For fixed bookings: rate as-is.
 *
 * Returns 0 when inputs are insufficient — never NaN — so list-view
 * sums don't poison the dashboard.
 */
export function siteTotalPaise(input: CampaignSiteRateInput): number {
  const rateInr = input.display_rate_inr ?? 0;
  if (!rateInr) return 0;
  const rateType = input.rate_type ?? "per_month";
  if (rateType === "fixed") {
    return Math.round(rateInr * 100);
  }
  if (rateType === "per_month" && input.start_date && input.end_date) {
    const start = new Date(input.start_date);
    const end = new Date(input.end_date);
    const days = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    );
    return Math.round((rateInr * days * 100) / 30);
  }
  // Fallback: treat as a flat amount (same as fixed) so we never lose
  // data. The form should prevent this case, but be defensive.
  return Math.round(rateInr * 100);
}

/**
 * Per-service total in paise — `rate × quantity`.
 */
export function serviceTotalPaise(input: CampaignServiceRateInput): number {
  const rate = input.rate_inr ?? 0;
  const qty = input.quantity ?? 0;
  if (!rate || !qty) return 0;
  return Math.round(rate * qty * 100);
}

/**
 * Whole-campaign value in paise.
 *
 *   itemized → Σ siteTotalPaise(site) + Σ serviceTotalPaise(service)
 *   bundled  → user-entered manualTotalInr × 100 (no automation; the
 *              package price is opinionated by the salesperson)
 *
 * Server actions call this on every create / update so the value
 * reflects the actual line items, regardless of what the form
 * happened to submit. Bundled mode still respects manual entries
 * because the entire point of bundled pricing is "I priced this as
 * a package, don't itemise it."
 */
export function computeCampaignValuePaise(input: {
  pricing_type: "itemized" | "bundled";
  sites: CampaignSiteRateInput[];
  services: CampaignServiceRateInput[];
  manualTotalInr?: number | null;
}): number {
  if (input.pricing_type === "bundled") {
    return Math.round((input.manualTotalInr ?? 0) * 100);
  }
  const siteSum = input.sites.reduce((acc, s) => acc + siteTotalPaise(s), 0);
  const serviceSum = input.services.reduce(
    (acc, s) => acc + serviceTotalPaise(s),
    0,
  );
  return siteSum + serviceSum;
}

// ─── DB-backed recompute ──────────────────────────────────────────────────
// Helper called by every mutation that touches campaign_sites or
// campaign_services so the persisted total_value_paise stays in sync
// with the line items. Bundled campaigns are skipped — their value
// is opinionated, not derived. Itemized campaigns get a fresh
// computation from the latest DB state.
//
// `supabase` is intentionally typed as `any` to avoid pulling
// the heavy generated types here; the calling action passes its
// own RLS-bound client.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export async function recomputeCampaignTotalValue(
  supabase: SupabaseLike,
  campaignId: string,
): Promise<{ totalPaise: number } | { error: string }> {
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("pricing_type")
    .eq("id", campaignId)
    .single();
  if (cErr || !campaign) return { error: cErr?.message ?? "Campaign not found" };

  // Bundled campaigns keep the manually-entered value — recompute
  // would just clobber the salesperson's package price with zero.
  if (campaign.pricing_type === "bundled") {
    const { data } = await supabase
      .from("campaigns")
      .select("total_value_paise")
      .eq("id", campaignId)
      .single();
    return { totalPaise: (data?.total_value_paise as number | null) ?? 0 };
  }

  // campaign_sites and campaign_services don't have deleted_at —
  // they cascade via the parent campaign's delete. We're already
  // gated on a single campaignId so this is safe; any join into
  // those tables from a list view should still filter on the parent
  // campaign's deleted_at.
  const [{ data: sites }, { data: services }] = await Promise.all([
    supabase
      .from("campaign_sites")
      .select("display_rate_paise, rate_type, start_date, end_date")
      .eq("campaign_id", campaignId),
    supabase
      .from("campaign_services")
      .select("rate_paise, quantity, total_paise")
      .eq("campaign_id", campaignId),
  ]);

  // The DB stores rate as paise; recomputeCampaignTotalValue receives
  // INR-shaped inputs from the helper above, so convert back. We
  // mirror siteTotalPaise's logic here directly to avoid an extra
  // round-trip through INR.
  type DbSite = {
    display_rate_paise: number | null;
    rate_type: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  type DbService = {
    rate_paise: number | null;
    quantity: number | null;
    total_paise: number | null;
  };
  const siteSum = ((sites ?? []) as DbSite[]).reduce((acc, s) => {
    const ratePaise = s.display_rate_paise ?? 0;
    if (!ratePaise) return acc;
    if ((s.rate_type ?? "per_month") === "fixed") return acc + ratePaise;
    if (s.start_date && s.end_date) {
      const startTs = new Date(s.start_date).getTime();
      const endTs = new Date(s.end_date).getTime();
      const days = Math.max(
        1,
        Math.ceil((endTs - startTs) / (1000 * 60 * 60 * 24)) + 1,
      );
      return acc + Math.round((ratePaise * days) / 30);
    }
    return acc + ratePaise;
  }, 0);
  const serviceSum = ((services ?? []) as DbService[]).reduce(
    (acc, s) => acc + (s.total_paise ?? 0),
    0,
  );
  const totalPaise = siteSum + serviceSum;

  const { error: uErr } = await supabase
    .from("campaigns")
    .update({ total_value_paise: totalPaise })
    .eq("id", campaignId);
  if (uErr) return { error: uErr.message };

  return { totalPaise };
}
