// Row 4: Top 5 + Bottom 5 sites by profit, SCOPED TO THE DASHBOARD
// DATE RANGE.
//
// Revenue is pro-rated with the same rules as the other range-aware
// sections (BookingsRow / CityBookingsRow / LocationBookingsRow) so
// the numbers line up — the same campaign contributes the same
// amount to the city rollup and to the per-site table.
//
//   rate_type = 'fixed'      → share = rate × overlap_days / total_days
//   rate_type = 'per_month'  → share = rate × overlap_days / 30
//   pricing_type = 'bundled' → campaign.total_value is split evenly
//                              across its sites, then pro-rated by overlap
//
// Costs are filtered to contract_payments whose payment_date falls
// inside the range. Services (printing / mounting) attach to
// campaigns, not sites, so they stay out of the per-site number — same
// gap that the city rollup documents.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";

interface SiteProfitRow {
  id: string;
  name: string;
  site_code: string;
  revenue: number;
  costs: number;
  profit: number;
}

export async function SitesRow({
  orgId,
  from,
  to,
}: {
  orgId: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();
  const tDash = await getTranslations("dashboard");

  // Pull just the campaign_sites that could overlap the range + the
  // parent campaign (for status gating, dates, pricing_type and
  // total value). We over-select slightly on the campaign side so
  // the pro-rata math matches the other sections exactly.
  const [
    { data: campaignSites },
    { data: rangeCosts },
    { data: siteRows },
  ] = await Promise.all([
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
      .from("contract_payments")
      .select("amount_paid_paise, payment_date, contract:contracts(site_id)")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", from)
      .lte("payment_date", to),
    supabase
      .from("sites")
      .select("id, name, site_code")
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

  // Drop deleted / cancelled campaigns up front so neither map nor
  // bundled-split picks them up.
  const rows = ((campaignSites ?? []) as unknown as CampaignSiteRow[]).filter(
    (r) => {
      const c = r.campaign;
      return !!c && !c.deleted_at && c.status !== "cancelled";
    },
  );

  // Group by campaign so bundled campaigns can equal-split their
  // total across sites. For itemized campaigns we rely on
  // display_rate_paise per site row directly.
  const byCampaign = new Map<string, CampaignSiteRow[]>();
  for (const r of rows) {
    const arr = byCampaign.get(r.campaign_id) ?? [];
    arr.push(r);
    byCampaign.set(r.campaign_id, arr);
  }

  const siteRevenue = new Map<string, number>();
  for (const siteRowsForCampaign of byCampaign.values()) {
    const sample = siteRowsForCampaign[0]?.campaign;
    if (!sample) continue;
    const isBundled = sample.pricing_type === "bundled";
    const bundledPerSite =
      isBundled && siteRowsForCampaign.length > 0
        ? Math.floor((sample.total_value_paise ?? 0) / siteRowsForCampaign.length)
        : 0;

    for (const row of siteRowsForCampaign) {
      const bookingFrom = row.start_date ?? sample.start_date;
      const bookingTo = row.end_date ?? sample.end_date;
      if (!bookingFrom || !bookingTo) continue;

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

      if (share > 0) {
        siteRevenue.set(
          row.site_id,
          (siteRevenue.get(row.site_id) ?? 0) + share,
        );
      }
    }
  }

  const siteCosts = new Map<string, number>();
  for (const row of (rangeCosts ?? []) as unknown as Array<{
    amount_paid_paise: number | null;
    payment_date: string | null;
    contract: { site_id: string | null } | null;
  }>) {
    const siteId = row.contract?.site_id;
    if (siteId) {
      siteCosts.set(
        siteId,
        (siteCosts.get(siteId) ?? 0) + (row.amount_paid_paise ?? 0),
      );
    }
  }

  const siteProfits: SiteProfitRow[] = (
    (siteRows ?? []) as Array<{ id: string; name: string; site_code: string }>
  ).map((s) => {
    const revenue = siteRevenue.get(s.id) ?? 0;
    const costs = siteCosts.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.name,
      site_code: s.site_code,
      revenue,
      costs,
      profit: revenue - costs,
    };
  });

  // Top 5 — only sites that actually earned something in the range.
  // Showing a "top 5" filled with ₹0 rows looks broken when the range
  // is narrow (e.g. "today") and only a handful of sites have activity.
  const earningSites = siteProfits.filter((s) => s.revenue > 0 || s.costs > 0);
  earningSites.sort((a, b) => b.profit - a.profit);
  const top5Sites = earningSites.slice(0, 5);
  const bottom5Sites = earningSites.slice(-5).reverse();

  const labels = {
    site: tDash("site"),
    revenue: tDash("revenue"),
    costs: tDash("costs"),
    profit: tDash("profit"),
    noData: tDash("no_data"),
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("top_sites")}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pro-rated to the selected range
          </p>
        </CardHeader>
        <CardContent>
          <SiteTable sites={top5Sites} labels={labels} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("bottom_sites")}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lowest profit in the selected range
          </p>
        </CardHeader>
        <CardContent>
          <SiteTable sites={bottom5Sites} isBottom labels={labels} />
        </CardContent>
      </Card>
    </div>
  );
}

function SiteTable({
  sites,
  isBottom = false,
  labels,
}: {
  sites: SiteProfitRow[];
  isBottom?: boolean;
  labels: { site: string; revenue: string; costs: string; profit: string; noData: string };
}) {
  const fmt = (p: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(p / 100);

  if (sites.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">{labels.noData}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <th className="text-left pb-2 font-semibold">{labels.site}</th>
          <th className="text-right pb-2 font-semibold">{labels.revenue}</th>
          <th className="text-right pb-2 font-semibold">{labels.costs}</th>
          <th className="text-right pb-2 font-semibold">{labels.profit}</th>
        </tr>
      </thead>
      <tbody>
        {sites.map((s) => (
          <tr key={s.id} className="border-b border-border last:border-0">
            <td className="py-3 pr-2">
              <p className="font-medium text-foreground truncate max-w-[140px]">{s.name}</p>
              <p className="text-[11px] text-muted-foreground">{s.site_code}</p>
            </td>
            <td className="py-3 text-right tabular-nums text-muted-foreground">{fmt(s.revenue)}</td>
            <td className="py-3 text-right tabular-nums text-muted-foreground">{fmt(s.costs)}</td>
            <td
              className={`py-3 text-right font-semibold tabular-nums ${
                isBottom || s.profit < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {fmt(s.profit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
