// KPI row — top-of-dashboard strip with 4 cards:
//   Revenue this month, Costs this month, Net profit, Site occupancy.
//
// Renders as an async Server Component so it can be wrapped in its own
// Suspense boundary. Each row (KpiRow, ChartsRow, SecondaryRow, etc.)
// fetches its own slice of data independently — slow queries in one
// row can't block the others from painting.
import { TrendingUp, TrendingDown, DollarSign, BarChart2, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function KpiRow({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const tDash = await getTranslations("dashboard");

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  // Six small queries, all in parallel — row paints as fast as the slowest.
  const [
    { data: thisMonthInvoices },
    { data: lastMonthInvoices },
    { data: thisMonthCosts },
    { data: lastMonthCosts },
    { data: allSites },
    { data: bookedSites },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("total_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", thisMonthStart)
      .is("deleted_at", null),
    supabase
      .from("invoices")
      .select("total_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", lastMonthStart)
      .lte("invoice_date", lastMonthEnd)
      .is("deleted_at", null),
    supabase
      .from("contract_payments")
      .select("amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", thisMonthStart),
    supabase
      .from("contract_payments")
      .select("amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", lastMonthStart)
      .lte("payment_date", lastMonthEnd),
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "booked")
      .is("deleted_at", null),
  ]);

  const sum = (rows: { total_paise?: number | null; amount_paid_paise?: number | null }[] | null, key: "total_paise" | "amount_paid_paise") =>
    (rows ?? []).reduce((s, r) => s + (r[key] ?? 0), 0);

  const thisMonthRevenue = sum(thisMonthInvoices, "total_paise");
  const lastMonthRevenue = sum(lastMonthInvoices, "total_paise");
  const thisMonthCostTotal = sum(thisMonthCosts, "amount_paid_paise");
  const lastMonthCostTotal = sum(lastMonthCosts, "amount_paid_paise");

  const netProfit = thisMonthRevenue - thisMonthCostTotal;
  const revenueChange = lastMonthRevenue > 0
    ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : 0;
  const costChange = lastMonthCostTotal > 0
    ? ((thisMonthCostTotal - lastMonthCostTotal) / lastMonthCostTotal) * 100
    : 0;
  const profitMargin = thisMonthRevenue > 0 ? (netProfit / thisMonthRevenue) * 100 : 0;

  const totalSiteCount = (allSites ?? []).length;
  const bookedSiteCount = (bookedSites ?? []).length;
  const occupancyPct = totalSiteCount > 0 ? Math.round((bookedSiteCount / totalSiteCount) * 100) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard
        title={tDash("revenue_this_month")}
        value={inr(thisMonthRevenue)}
        changePercent={revenueChange}
        iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
        icon={<DollarSign className="h-5 w-5" />}
        vsLabel={tDash("vsLastMonth")}
      />
      <KpiCard
        title={tDash("costs_this_month")}
        value={inr(thisMonthCostTotal)}
        changePercent={-costChange}
        iconBg="bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
        icon={<BarChart2 className="h-5 w-5" />}
        vsLabel={tDash("vsLastMonth")}
      />
      <KpiCard
        title={tDash("net_profit")}
        value={inr(netProfit)}
        changePercent={profitMargin}
        iconBg="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
        icon={<TrendingUp className="h-5 w-5" />}
        vsLabel={tDash("vsLastMonth")}
      />
      <Card className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-violet-500/10 to-transparent blur-2xl"
        />
        <CardHeader className="flex flex-row items-start justify-between pb-3 space-y-0 relative">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {tDash("site_occupancy")}
          </CardTitle>
          <div className="h-10 w-10 rounded-xl flex items-center justify-center ring-1 ring-inset ring-border/60 bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
            <Building2 className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="text-[28px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
            {occupancyPct}%
          </div>
          <Progress value={occupancyPct} className="mt-4 h-1.5" />
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {bookedSiteCount} {tDash("of_sites_booked", { total: totalSiteCount })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  changePercent,
  icon,
  iconBg,
  vsLabel,
}: {
  title: string;
  value: string;
  changePercent: number;
  icon: React.ReactNode;
  iconBg: string;
  vsLabel: string;
}) {
  const isPositive = changePercent >= 0;
  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-2xl"
      />
      <CardHeader className="flex flex-row items-start justify-between pb-3 space-y-0 relative">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </CardTitle>
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ring-1 ring-inset ring-border/60 ${iconBg}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-[28px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
          {value}
        </div>
        <div
          className={`mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isPositive
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
          }`}
        >
          {isPositive ? (
            <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
          ) : (
            <TrendingDown className="h-3 w-3" strokeWidth={2.5} />
          )}
          <span className="tabular-nums">{Math.abs(changePercent).toFixed(1)}%</span>
          <span className="text-muted-foreground font-normal ml-0.5">{vsLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}
