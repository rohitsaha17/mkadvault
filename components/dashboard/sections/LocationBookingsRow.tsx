// Location/site-level booking table — the per-site slice of the
// pro-rata booking math. Shows the top sites by booked value in the
// range, so the owner can see which hoardings are earning their keep.
// Pairs with CityBookingsRow (which rolls up by city) to let the owner
// drill down one more level.
//
// Columns: Site · City · Media type · Status · Booked value in range.
// Sorted descending by value. Capped at 15 rows — the top earners tell
// the story without turning this into an endless scroll.
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ArrowUpRight } from "lucide-react";

const MAX_ROWS = 15;

export async function LocationBookingsRow({
  orgId,
  from,
  to,
}: {
  orgId: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();

  const [{ data: campaignSites }, { data: sites }] = await Promise.all([
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
        campaign:campaigns(start_date, end_date, status, deleted_at, pricing_type, total_value_paise)
      `,
      )
      .eq("organization_id", orgId),
    supabase
      .from("sites")
      .select("id, name, site_code, city, media_type, status")
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
  };

  type Site = {
    id: string;
    name: string;
    site_code: string | null;
    city: string | null;
    media_type: string | null;
    status: string | null;
  };

  // Group by campaign so we can equal-split bundled campaign totals
  // across the campaign's sites — same logic as CityBookingsRow.
  const filteredRows = ((campaignSites ?? []) as unknown as CampaignSiteRow[]).filter(
    (r) => {
      const c = r.campaign;
      return !!c && !c.deleted_at && c.status !== "cancelled";
    },
  );
  const byCampaign = new Map<string, CampaignSiteRow[]>();
  for (const r of filteredRows) {
    const arr = byCampaign.get(r.campaign_id) ?? [];
    arr.push(r);
    byCampaign.set(r.campaign_id, arr);
  }

  const perSiteValue = new Map<string, number>();
  const perSiteCampaigns = new Map<string, number>();
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

      // Same pro-rata rules as the campaign-total trigger (migration 042):
      let share = 0;
      if (isBundled) {
        share = prorateByRange(bookingFrom, bookingTo, bundledPerSite, from, to);
      } else if (row.rate_type === "per_month") {
        const overlapStart = bookingFrom > from ? bookingFrom : from;
        const overlapEnd = bookingTo < to ? bookingTo : to;
        if (overlapEnd >= overlapStart) {
          const overlapDays = daysInRange(overlapStart, overlapEnd);
          share = Math.round(
            ((row.display_rate_paise ?? 0) * overlapDays) / 30,
          );
        }
      } else {
        share = prorateByRange(
          bookingFrom,
          bookingTo,
          row.display_rate_paise ?? 0,
          from,
          to,
        );
      }
      if (share <= 0) continue;

      perSiteValue.set(
        row.site_id,
        (perSiteValue.get(row.site_id) ?? 0) + share,
      );
      perSiteCampaigns.set(
        row.site_id,
        (perSiteCampaigns.get(row.site_id) ?? 0) + 1,
      );
    }
  }

  const rows = ((sites ?? []) as Site[])
    .map((s) => ({
      ...s,
      value: perSiteValue.get(s.id) ?? 0,
      campaigns: perSiteCampaigns.get(s.id) ?? 0,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-end justify-between">
        <div>
          <CardTitle className="text-base">Top sites by booking value</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Pro-rated to the selected range — where the revenue is coming from
          </p>
        </div>
        {rows.length > 0 && (
          <Link
            href="/sites"
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            All sites
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-sm text-center text-muted-foreground">
            No site-level bookings in this range
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left pb-2 font-semibold">Site</th>
                  <th className="text-left pb-2 font-semibold">City</th>
                  <th className="text-left pb-2 font-semibold hidden sm:table-cell">
                    Type
                  </th>
                  <th className="text-left pb-2 font-semibold hidden md:table-cell">
                    Status
                  </th>
                  <th className="text-right pb-2 font-semibold">
                    Campaigns
                  </th>
                  <th className="text-right pb-2 font-semibold">
                    Booked (range)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="py-3 pr-2">
                      <Link
                        href={`/sites/${s.id}`}
                        className="font-medium text-foreground hover:underline truncate block max-w-[180px]"
                      >
                        {s.name}
                      </Link>
                      {s.site_code && (
                        <p className="text-[11px] text-muted-foreground">
                          {s.site_code}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-2 text-foreground">
                      {s.city ?? "—"}
                    </td>
                    <td className="py-3 pr-2 text-muted-foreground capitalize hidden sm:table-cell">
                      {s.media_type?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="py-3 pr-2 hidden md:table-cell">
                      <StatusBadge status={s.status ?? "—"} />
                    </td>
                    <td className="py-3 pr-2 text-right tabular-nums text-foreground">
                      {s.campaigns}
                    </td>
                    <td className="py-3 text-right font-semibold tabular-nums text-foreground">
                      {inr(s.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
