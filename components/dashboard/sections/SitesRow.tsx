// Row 4: Top 5 and Bottom 5 sites by profit. Pulls a broad cut of
// campaign revenue + contract costs + site names, then aggregates
// per-site profit. Own Suspense boundary.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";

interface SiteProfitRow {
  id: string;
  name: string;
  site_code: string;
  revenue: number;
  costs: number;
  profit: number;
}

export async function SitesRow({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const tDash = await getTranslations("dashboard");

  const [
    { data: revenueBySite },
    { data: costsByContract },
    { data: siteRows },
  ] = await Promise.all([
    supabase
      .from("campaign_sites")
      .select("site_id, display_rate_paise, campaign:campaigns(status)")
      .eq("organization_id", orgId),
    supabase
      .from("contract_payments")
      .select("amount_paid_paise, contract:contracts(site_id)")
      .eq("organization_id", orgId)
      .eq("status", "paid"),
    supabase
      .from("sites")
      .select("id, name, site_code")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  const siteRevenue = new Map<string, number>();
  for (const row of (revenueBySite ?? []) as unknown as Array<{
    site_id: string;
    display_rate_paise: number | null;
    campaign: { status: string } | null;
  }>) {
    const s = row.campaign?.status;
    if (s === "live" || s === "completed") {
      siteRevenue.set(row.site_id, (siteRevenue.get(row.site_id) ?? 0) + (row.display_rate_paise ?? 0));
    }
  }

  const siteCosts = new Map<string, number>();
  for (const row of (costsByContract ?? []) as unknown as Array<{
    amount_paid_paise: number | null;
    contract: { site_id: string } | null;
  }>) {
    const siteId = row.contract?.site_id;
    if (siteId) {
      siteCosts.set(siteId, (siteCosts.get(siteId) ?? 0) + (row.amount_paid_paise ?? 0));
    }
  }

  const siteProfits: SiteProfitRow[] = ((siteRows ?? []) as Array<{ id: string; name: string; site_code: string }>).map((s) => {
    const revenue = siteRevenue.get(s.id) ?? 0;
    const costs = siteCosts.get(s.id) ?? 0;
    return { id: s.id, name: s.name, site_code: s.site_code, revenue, costs, profit: revenue - costs };
  });

  siteProfits.sort((a, b) => b.profit - a.profit);
  const top5Sites = siteProfits.slice(0, 5);
  const bottom5Sites = siteProfits.slice(-5).reverse();

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
        </CardHeader>
        <CardContent>
          <SiteTable sites={top5Sites} labels={labels} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("bottom_sites")}</CardTitle>
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
