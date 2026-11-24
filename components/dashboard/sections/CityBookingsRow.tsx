// Where bookings are landing — one card per range: a night-city tile naming
// the leading city, and a list of every city with its booked value and how
// many of its sites are taken.
//
// Both figures aggregate from campaign_sites → sites, so a hoarding in Pune
// counts against Pune even when the campaign itself spans ten cities.
// Pro-rata math uses prorateByRange() on each campaign_site's
// display_rate_paise with the site-level start_date / end_date, then
// falls back to the campaign dates when a site row hasn't overridden
// them (common for campaigns booked as a single block).
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import city from "@/assets/dashboard/city-night.webp";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/dashboard/IconTile";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";

const TOP_N = 7;

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
  const t = await getTranslations("dashboard");

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

  // Occupancy per city (headcount of sites by status). Maintenance, blocked
  // and expired sites stay out of it — see the KpiRow note on the denominator.
  const cityOccupancy = new Map<string, { booked: number; total: number }>();
  for (const s of (allSites ?? []) as Array<{
    city: string | null;
    status: string | null;
  }>) {
    if (s.status !== "booked" && s.status !== "available") continue;
    const name = s.city?.trim() || "Unknown";
    const bucket = cityOccupancy.get(name) ?? { booked: 0, total: 0 };
    bucket.total += 1;
    if (s.status === "booked") bucket.booked += 1;
    cityOccupancy.set(name, bucket);
  }

  const cities = [...new Set([...cityValue.keys(), ...cityOccupancy.keys()])]
    .map((name) => ({
      name,
      value: cityValue.get(name) ?? 0,
      booked: cityOccupancy.get(name)?.booked ?? 0,
      total: cityOccupancy.get(name)?.total ?? 0,
    }))
    .sort((a, b) => b.value - a.value || b.total - a.total);

  // Fold the tail into one row so the list stays readable.
  const cityRows = cities.slice(0, TOP_N);
  const rest = cities.slice(TOP_N);
  if (rest.length > 0) {
    cityRows.push({
      name: t("more_cities", { count: rest.length }),
      value: rest.reduce((s, c) => s + c.value, 0),
      booked: rest.reduce((s, c) => s + c.booked, 0),
      total: rest.reduce((s, c) => s + c.total, 0),
    });
  }

  const lead = cities[0] && cities[0].value > 0 ? cities[0] : null;

  return (
    <Card className="gap-0 overflow-hidden rounded-3xl p-0 py-0 lg:grid lg:grid-cols-12">
      <div className="dark relative isolate flex min-h-72 flex-col justify-between overflow-hidden bg-black p-5 text-foreground sm:p-6 lg:col-span-5">
        <Image
          src={city}
          alt=""
          fill
          sizes="(min-width: 64rem) 470px, 100vw"
          className="-z-10 object-cover object-bottom"
        />
        <span
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-black via-black/35 to-black/20"
        />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h3 className="text-xl font-semibold">{t("cities_title")}</h3>
            <p className="text-sm text-white/70">
              {t("cities_sub", {
                value: inr(totalValue),
                count: cityValue.size,
              })}
            </p>
          </div>
          <IconTile name="pin" />
        </div>
        {lead && (
          <div className="glass mt-24 w-fit max-w-full rounded-2xl px-4 py-3">
            <p className="text-sm text-white/75">{lead.name}</p>
            <p className="figure mt-1.5 text-2xl text-white">
              {inr(lead.value)}
            </p>
            <p className="mt-1.5 text-xs text-volt">
              {t("city_share", {
                percent: Math.round((lead.value / totalValue) * 100),
              })}
            </p>
          </div>
        )}
      </div>

      <div className="p-5 sm:p-6 lg:col-span-7">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>{t("city_list_label")}</span>
          <span className="flex gap-4">
            <span className="flex items-center gap-2">
              <span className="h-2 w-4 rounded-full bg-chart-1" />
              {t("booked")}
            </span>
            <span className="flex items-center gap-2">
              <span className="hatch h-2 w-4 rounded-full bg-muted" />
              {t("open")}
            </span>
          </span>
        </div>
        {cityRows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("no_sites_yet")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {cityRows.map((c) => (
              <li key={c.name} className="py-3 last:pb-0">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {c.name}
                    {c.total > 0 && (
                      <span className="ml-2 font-normal text-xs text-muted-foreground">
                        {t("sites_booked", {
                          booked: c.booked,
                          total: c.total,
                        })}
                      </span>
                    )}
                  </p>
                  <p
                    className={
                      c.value > 0
                        ? "shrink-0 text-sm font-semibold tabular-nums"
                        : "shrink-0 text-sm text-muted-foreground"
                    }
                  >
                    {inr(c.value)}
                  </p>
                </div>
                {c.total > 0 && (
                  <div className="hatch mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: `${(c.booked / c.total) * 100}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
