// Site P&L Report — per-site revenue vs cost analysis.
//
// Data flow:
//   1. Fetch all sites for this org
//   2. Fetch all campaign_sites with campaign status (to determine revenue)
//   3. Fetch all contract_payments with status='paid' + their contract (to get site cost)
//   4. Aggregate in TypeScript — no SQL GROUP BY needed (dataset is manageable)
//
// All monetary values are in integer paise throughout. Display divides by 100.

import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowUpDown, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { SitePnlExport, type SitePnlRow } from "@/components/reports/SitePnlExport";

// ─── Types for Supabase join results ─────────────────────────────────────────
// Supabase returns joined rows as nested objects. We cast with `as unknown as T`
// because the generated SDK types don't always infer deep joins correctly.

interface CampaignSiteWithCampaign {
  site_id: string;
  display_rate_paise: number | null;
  campaign: {
    status: string;
  } | null;
}

interface ContractPaymentWithContract {
  amount_paid_paise: number | null;
  contract: {
    site_id: string;
  } | null;
}

// ─── Sort helper ──────────────────────────────────────────────────────────────
// Reads URL search params for ?sort=<column>&dir=<asc|desc>.

type SortKey = "revenue_paise" | "costs_paise" | "profit_paise" | "margin_pct" | "name";

function sortRows(rows: SitePnlRow[], sort: SortKey, dir: "asc" | "desc"): SitePnlRow[] {
  return [...rows].sort((a, b) => {
    const aVal = a[sort] ?? 0;
    const bVal = b[sort] ?? 0;
    // String comparison for name, numeric for everything else
    const cmp = typeof aVal === "string"
      ? (aVal as string).localeCompare(bVal as string)
      : (aVal as number) - (bVal as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SitePnlPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/${locale}/login`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (!profile?.org_id) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        Your account is not linked to an organisation yet.
      </div>
    );
  }

  const orgId: string = profile.org_id;

  // ── 1. Fetch sites ──────────────────────────────────────────────────────────
  const { data: sitesData, error: sitesError } = await supabase
    .from("sites")
    .select("id, name, site_code, city, status, total_sqft, base_rate_paise")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("city");

  if (sitesError) {
    return <div className="p-6 text-red-500 text-sm">Failed to load sites: {sitesError.message}</div>;
  }

  const sites = sitesData ?? [];

  // ── 2. Fetch campaign_sites with campaign status ────────────────────────────
  // We only count revenue for campaigns that are live or completed.
  const { data: campaignSitesData } = await supabase
    .from("campaign_sites")
    .select("site_id, display_rate_paise, campaign:campaigns(status)")
    .eq("organization_id", orgId);

  const campaignSites = (campaignSitesData ?? []) as unknown as CampaignSiteWithCampaign[];

  // ── 3. Fetch paid contract payments + their contract's site_id ─────────────
  const { data: contractPaymentsData } = await supabase
    .from("contract_payments")
    .select("amount_paid_paise, contract:contracts(site_id)")
    .eq("organization_id", orgId)
    .eq("status", "paid");

  const contractPayments = (contractPaymentsData ?? []) as unknown as ContractPaymentWithContract[];

  // ── 4. Aggregate per site ──────────────────────────────────────────────────

  // Revenue map: site_id → total paise earned from live/completed campaigns
  const revenueMap = new Map<string, number>();
  for (const cs of campaignSites) {
    const campaignStatus = cs.campaign?.status ?? "";
    if (campaignStatus === "live" || campaignStatus === "completed") {
      const prev = revenueMap.get(cs.site_id) ?? 0;
      revenueMap.set(cs.site_id, prev + (cs.display_rate_paise ?? 0));
    }
  }

  // Cost map: site_id → total paise paid out via contracts
  const costMap = new Map<string, number>();
  for (const cp of contractPayments) {
    const siteId = cp.contract?.site_id;
    if (!siteId) continue;
    const prev = costMap.get(siteId) ?? 0;
    costMap.set(siteId, prev + (cp.amount_paid_paise ?? 0));
  }

  // Build SitePnlRow array
  const rows: SitePnlRow[] = sites.map((site) => {
    const revenue = revenueMap.get(site.id) ?? 0;
    const costs = costMap.get(site.id) ?? 0;
    const profit = revenue - costs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      id: site.id,
      name: site.name as string,
      site_code: site.site_code as string,
      city: site.city as string,
      status: site.status as string,
      total_sqft: site.total_sqft as number | null,
      revenue_paise: revenue,
      costs_paise: costs,
      profit_paise: profit,
      margin_pct: Math.round(margin * 10) / 10, // one decimal place
    };
  });

  // ── 5. Sort based on query params ─────────────────────────────────────────
  const validSortKeys: SortKey[] = ["revenue_paise", "costs_paise", "profit_paise", "margin_pct", "name"];
  const rawSort = Array.isArray(sp.sort) ? sp.sort[0] : (sp.sort ?? "profit_paise");
  const rawDir = Array.isArray(sp.dir) ? sp.dir[0] : (sp.dir ?? "desc");
  const sortKey: SortKey = validSortKeys.includes(rawSort as SortKey) ? (rawSort as SortKey) : "profit_paise";
  const sortDir: "asc" | "desc" = rawDir === "asc" ? "asc" : "desc";

  const sorted = sortRows(rows, sortKey, sortDir);

  // ── 6. Summary totals ─────────────────────────────────────────────────────
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue_paise, 0);
  const totalCosts = rows.reduce((sum, r) => sum + r.costs_paise, 0);
  const totalProfit = totalRevenue - totalCosts;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // Helper to build sort link: toggle direction if same column, default desc for new column
  function sortHref(col: SortKey): string {
    const newDir = col === sortKey && sortDir === "desc" ? "asc" : "desc";
    return `?sort=${col}&dir=${newDir}`;
  }

  const locale2 = locale; // capture for use in JSX

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Site P&amp;L</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue vs costs for every site across all live and completed campaigns
          </p>
        </div>
        <SitePnlExport data={sorted} />
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Revenue" value={inr(totalRevenue)} />
        <SummaryCard label="Total Costs" value={inr(totalCosts)} />
        <SummaryCard
          label="Net Profit"
          value={inr(totalProfit)}
          highlight={totalProfit >= 0 ? "green" : "red"}
        />
        <SummaryCard label="Avg Margin" value={`${avgMargin.toFixed(1)}%`} />
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">No sites found.</p>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Site Name</TableHead>
                <TableHead>City</TableHead>
                <TableHead>
                  <Link href={sortHref("revenue_paise")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Revenue <ArrowUpDown className="h-3 w-3 opacity-60" />
                  </Link>
                </TableHead>
                <TableHead>
                  <Link href={sortHref("costs_paise")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Costs <ArrowUpDown className="h-3 w-3 opacity-60" />
                  </Link>
                </TableHead>
                <TableHead>
                  <Link href={sortHref("profit_paise")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Net Profit <ArrowUpDown className="h-3 w-3 opacity-60" />
                  </Link>
                </TableHead>
                <TableHead>
                  <Link href={sortHref("margin_pct")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Margin % <ArrowUpDown className="h-3 w-3 opacity-60" />
                  </Link>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium text-foreground leading-tight">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.site_code}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.city}</TableCell>
                  <TableCell className="tabular-nums">{inr(row.revenue_paise)}</TableCell>
                  <TableCell className="tabular-nums">{inr(row.costs_paise)}</TableCell>
                  <TableCell
                    className={`tabular-nums font-semibold ${
                      row.profit_paise >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {inr(row.profit_paise)}
                  </TableCell>
                  <TableCell
                    className={`tabular-nums font-medium ${
                      row.margin_pct >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {row.margin_pct.toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <SiteStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/${locale2}/sites/${row.id}`}>
                      <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "green" | "red";
}) {
  const valueClass =
    highlight === "green"
      ? "text-emerald-600"
      : highlight === "red"
      ? "text-red-600"
      : "text-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function SiteStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    available: "bg-emerald-100 text-emerald-700",
    booked: "bg-blue-100 text-blue-700",
    maintenance: "bg-amber-100 text-amber-700",
    blocked: "bg-muted text-muted-foreground",
    expired: "bg-red-100 text-red-700",
  };
  const cls = map[status] ?? "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-xs font-normal border-0 ${cls}`}>
      {status}
    </Badge>
  );
}
