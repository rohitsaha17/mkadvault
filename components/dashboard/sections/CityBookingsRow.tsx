// City breakdown — two side-by-side bar charts:
//
//   Left:  Booking value by city (pro-rata, scoped to the range)
//   Right: Site occupancy by city (booked vs available)
//
// Both aggregate from campaign_sites → sites, so a hoarding in Pune
// counts against Pune even when the campaign itself spans ten cities.
// Pro-rata math uses prorateByRange() on each campaign_site's
// display_rate_paise with the site-level start_date / end_date, then
// falls back to the campaign dates when a site row hasn't overridden
// them (common for campaigns booked as a single block).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";
import {
  CityBookingsChart,
  CityOccupancyChart,
} from "@/components/dashboard/DashboardCharts";

const TOP_N = 10;

export async function CityBookingsRow({
  orgId,
  from,
  to,
}: {
  orgId: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();

  // Pull campaign_sites that could touch the range + the parent
  // campaign (for status gating, dates, pricing_type, total value) and
  // the underlying site (for its city label).
  const [{ data: campaignSites }, { data: allSites }] = await Promise.all([
    supabase
      .from("campaign_sites")
      .select(
        `
        campaign_id,
        site_id,
        display_rate_paise,
        rate_type,
        start_date,
        end_date,
        campaign:campaigns(start_date, end_date, status, deleted_at, pricing_type, total_value_paise),
        site:sites(city)
      `,
      )
      .eq("organization_id", orgId),
    supabase
      .from("sites")
      .select("id, city, status")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  type CampaignSiteRow = {
    campaign_id: string;
    site_id: string;
    display_rate_paise: number | null;
    rate_type: "per_month" | "fixed" | null;
    start_date: string | null;
    end_date: string | null;
    campaign: {
      start_date: string | null;
      end_date: string | null;
      status: string | null;
      deleted_at: string | null;
      pricing_type: "itemized" | "bundled" | null;
      total_value_paise: number | null;
    } | null;
    site: { city: string | null } | null;
  };

  // Group by campaign so we can equal-split bundled totals across the
  // campaign's sites. For itemized campaigns we use per-site rates
  // directly (display_rate_paise). Bundled campaigns don't carry a
  // per-site rate — their total lives on campaigns.total_value_paise.
  const rows = ((campaignSites ?? []) as unknown as CampaignSiteRow[]).filter(
    (r) => {
      const c = r.campaign;
      return !!c && !c.deleted_at && c.status !== "cancelled";
    },
  );
  const byCampaign = new Map<string, CampaignSiteRow[]>();
  for (const r of rows) {
    const arr = byCampaign.get(r.campaign_id) ?? [];
    arr.push(r);
    byCampaign.set(r.campaign_id, arr);
  }

  // Booking value per city — pro-rated to the range using the same
  // formula the campaign-total trigger (migration 042) uses:
  //
  //   rate_type = 'fixed'      → share = rate × overlap_days / total_days
  //   rate_type = 'per_month'  → share = rate × overlap_days / 30
  //   pricing_type = 'bundled' → campaign.total_value split evenly across
  //                              its sites, then pro-rated by overlap.
  //
  // Services (printing, mounting, etc.) attach to campaigns, not sites,
  // so they can't be attributed to a city and are intentionally left
  // out here — that's why the City total is lower than the headline
  // "Booked Value in Range" on the BookingsRow.
  const cityValue = new Map<string, number>();
  let totalValue = 0;
  for (const siteRows of byCampaign.values()) {
    const sample = siteRows[0]?.campaign;
    if (!sample) continue;
    const isBundled = sample.pricing_type === "bundled";
    const bundledPerSite = isBundled && siteRows.length > 0
      ? Math.floor((sample.total_value_paise ?? 0) / siteRows.length)
      : 0;

    for (const row of siteRows) {
      const bookingFrom = row.start_date ?? sample.start_date;
      const bookingTo = row.end_date ?? sample.end_date;
      if (!bookingFrom || !bookingTo) continue;

      const city = row.site?.city?.trim() || "Unknown";

      let share = 0;
      if (isBundled) {
        // Bundled: pro-rate the even-split by booking overlap.
        share = prorateByRange(bookingFrom, bookingTo, bundledPerSite, from, to);
      } else if (row.rate_type === "per_month") {
        // Monthly rate: value-for-range = rate × overlap_days / 30,
        // independent of the campaign's total duration.
        const overlapStart =
          bookingFrom > from ? bookingFrom : from;
        const overlapEnd = bookingTo < to ? bookingTo : to;
        if (overlapEnd >= overlapStart) {
          const overlapDays = daysInRange(overlapStart, overlapEnd);
          share = Math.round(
            ((row.display_rate_paise ?? 0) * overlapDays) / 30,
          );
        }
      } else {
        // Fixed: pro-rate flat rate by overlap ÷ total booking duration.
        share = prorateByRange(
          bookingFrom,
          bookingTo,
          row.display_rate_paise ?? 0,
          from,
          to,
        );
      }

      if (share <= 0) continue;
      cityValue.set(city, (cityValue.get(city) ?? 0) + share);
      totalValue += share;
    }
  }

  const cityValueSorted = [...cityValue.entries()]
    .map(([city, value]) => ({ city, value }))
    .sort((a, b) => b.value - a.value);

  // Collapse the tail into "Others" so the chart stays readable.
  const topCities = cityValueSorted.slice(0, TOP_N);
  const tail = cityValueSorted.slice(TOP_N);
  if (tail.length > 0) {
    const tailTotal = tail.reduce((s, r) => s + r.value, 0);
    topCities.push({ city: `Others (${tail.length})`, value: tailTotal });
  }

  // Occupancy per city (headcount of sites by status).
  const cityOccupancy = new Map<
    string,
    { booked: number; available: number }
  >();
  for (const s of (allSites ?? []) as Array<{
    city: string | null;
    status: string | null;
  }>) {
    const city = s.city?.trim() || "Unknown";
    const bucket = cityOccupancy.get(city) ?? { booked: 0, available: 0 };
    if (s.status === "booked") bucket.booked += 1;
    else if (s.status === "available") bucket.available += 1;
    // Sites in maintenance/blocked/expired are excluded from the
    // occupancy bar — see KpiRow comment on the denominator.
    cityOccupancy.set(city, bucket);
  }
  const occupancyRows = [...cityOccupancy.entries()]
    .map(([city, v]) => ({ city, ...v, total: v.booked + v.available }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_N);

  // Chart data must be in the order the chart expects for the Y-axis to
  // show biggest at the top. We feed smallest→largest so recharts' bottom-
  // up Y-axis puts the biggest city on top.
  const valueData = topCities.map(({ city, value }) => ({
    city,
    value,
    sites: cityOccupancy.get(city)?.booked ?? 0,
  }));
  valueData.reverse();
  const occupancyData = occupancyRows.map(({ city, booked, available }) => ({
    city,
    booked,
    available,
  }));
  occupancyData.reverse();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-[1px] w-5 bg-primary/70"
          />
          <p className="font-display italic text-[13px] text-primary/85">
            Geography
          </p>
        </div>
        <h2 className="font-display text-[26px] tracking-tight text-foreground leading-tight">
          Where bookings are landing
        </h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 space-y-1 pt-6">
            <CardTitle className="font-display text-[22px] tracking-tight leading-tight">
              Booked value by city
            </CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              {inr(totalValue)} across {cityValue.size}{" "}
              {cityValue.size === 1 ? "city" : "cities"} in this window
            </p>
          </CardHeader>
          <CardContent className="pb-6">
            <CityBookingsChart data={valueData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3 space-y-1 pt-6">
            <CardTitle className="font-display text-[22px] tracking-tight leading-tight">
              Site occupancy by city
            </CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              {occupancyRows.length} cities · booked against available right now
            </p>
          </CardHeader>
          <CardContent className="pb-6">
            <CityOccupancyChart data={occupancyData} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
