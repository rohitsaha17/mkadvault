// KPI row — top-of-dashboard strip. Four uniform cards matching the
// reference comp vocabulary (Nexora, Donezo, AeuxGlobal): label + big
// number + delta line + a corner sparkline showing the series the
// figure summarises. One card — Revenue — wears the lime accent as
// the lead moment.
//
// Revenue uses invoice TAXABLE VALUE (subtotal). Cost combines
// contract_payments (paid, by payment_date) and site_expenses
// (status=paid, by paid_at) — the finance team pays rent through
// contracts AND files one-off payment requests, and the dashboard
// has to see both.
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/Sparkline";

export async function KpiRow({
  orgId,
  from,
  to,
}: {
  orgId: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();

  // Previous period of equal length for the "vs previous" delta.
  const MS_PER_DAY = 86_400_000;
  const fromMs = Date.parse(from + "T00:00:00Z");
  const toMs = Date.parse(to + "T00:00:00Z");
  const spanDays = Math.max(1, Math.floor((toMs - fromMs) / MS_PER_DAY) + 1);
  const prevToDate = new Date(fromMs - MS_PER_DAY);
  const prevFromDate = new Date(fromMs - spanDays * MS_PER_DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const prevFrom = iso(prevFromDate);
  const prevTo = iso(prevToDate);
  const paidFromTs = `${from}T00:00:00Z`;
  const paidToTs = `${to}T23:59:59Z`;
  const prevPaidFromTs = `${prevFrom}T00:00:00Z`;
  const prevPaidToTs = `${prevTo}T23:59:59Z`;

  // One query bank. The sparkline series need the invoice_date /
  // payment_date column alongside the figure so we can bucket into
  // ~12 points for the spark.
  const [
    { data: thisInvoices },
    { data: prevInvoices },
    { data: thisContractCosts },
    { data: prevContractCosts },
    { data: thisExpenseCosts },
    { data: prevExpenseCosts },
    { data: allSites },
    { data: bookedSites },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("subtotal_paise, invoice_date")
      .eq("organization_id", orgId)
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .is("deleted_at", null),
    supabase
      .from("invoices")
      .select("subtotal_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", prevFrom)
      .lte("invoice_date", prevTo)
      .is("deleted_at", null),
    supabase
      .from("contract_payments")
      .select("amount_paid_paise, payment_date")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", from)
      .lte("payment_date", to),
    supabase
      .from("contract_payments")
      .select("amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", prevFrom)
      .lte("payment_date", prevTo),
    supabase
      .from("site_expenses")
      .select("amount_paise, paid_at")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", paidFromTs)
      .lte("paid_at", paidToTs)
      .is("deleted_at", null),
    supabase
      .from("site_expenses")
      .select("amount_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", prevPaidFromTs)
      .lte("paid_at", prevPaidToTs)
      .is("deleted_at", null),
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .in("status", ["available", "booked"])
      .is("deleted_at", null),
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "booked")
      .is("deleted_at", null),
  ]);

  const sumPaise = <K extends string>(
    rows: Array<Partial<Record<K, number | null>>> | null,
    key: K,
  ): number => (rows ?? []).reduce((s, r) => s + (r[key] ?? 0), 0);

  const thisMonthRevenue = sumPaise(thisInvoices, "subtotal_paise");
  const lastMonthRevenue = sumPaise(prevInvoices, "subtotal_paise");
  const thisMonthCostTotal =
    sumPaise(thisContractCosts, "amount_paid_paise") +
    sumPaise(thisExpenseCosts, "amount_paise");
  const lastMonthCostTotal =
    sumPaise(prevContractCosts, "amount_paid_paise") +
    sumPaise(prevExpenseCosts, "amount_paise");

  const netProfit = thisMonthRevenue - thisMonthCostTotal;
  const revenueChange =
    lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : null;
  const costChange =
    lastMonthCostTotal > 0
      ? ((thisMonthCostTotal - lastMonthCostTotal) / lastMonthCostTotal) * 100
      : null;
  const profitMargin =
    thisMonthRevenue > 0 ? (netProfit / thisMonthRevenue) * 100 : null;

  const totalSiteCount = (allSites ?? []).length;
  const bookedSiteCount = (bookedSites ?? []).length;
  const occupancyPct =
    totalSiteCount > 0 ? Math.round((bookedSiteCount / totalSiteCount) * 100) : 0;

  // Build sparkline series — monthly buckets so a 12-month FY draws a
  // 12-point line. Buckets use YYYY-MM keys so lexical sort === time.
  const revenueSpark = bucketMonthly(
    (thisInvoices ?? []) as Array<{ invoice_date: string; subtotal_paise: number | null }>,
    (r) => r.invoice_date,
    (r) => r.subtotal_paise ?? 0,
  );
  const contractCostSpark = bucketMonthly(
    (thisContractCosts ?? []) as Array<{ payment_date: string | null; amount_paid_paise: number | null }>,
    (r) => r.payment_date ?? "",
    (r) => r.amount_paid_paise ?? 0,
  );
  const expenseCostSpark = bucketMonthly(
    (thisExpenseCosts ?? []) as Array<{ paid_at: string | null; amount_paise: number | null }>,
    (r) => (r.paid_at ?? "").slice(0, 10),
    (r) => r.amount_paise ?? 0,
  );
  // Merge the two cost streams into one spark by month.
  const costSpark = mergeMonthly(contractCostSpark, expenseCostSpark);
  // Net profit spark = revenue - cost per month, for whatever months
  // appear in either.
  const profitSpark = diffMonthly(revenueSpark, costSpark);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard
        label="Revenue"
        value={inr(thisMonthRevenue)}
        subtitle={`${thisInvoices?.length ?? 0} invoices · taxable`}
        changePercent={revenueChange}
        spark={revenueSpark.map((b) => b.v)}
        accent
      />
      <KpiCard
        label="Cost"
        value={inr(thisMonthCostTotal)}
        subtitle="Rent paid + requests"
        // Lower cost is a good thing, so flip the sign on the arrow.
        changePercent={costChange === null ? null : -costChange}
        spark={costSpark.map((b) => b.v)}
      />
      <KpiCard
        label="Net profit"
        value={inr(netProfit)}
        subtitle="Revenue − cost"
        changePercent={profitMargin}
        changeSuffix="margin"
        spark={profitSpark.map((b) => b.v)}
      />
      <Card className="relative overflow-hidden">
        <CardContent className="relative p-5 space-y-3">
          <div className="flex items-start justify-between">
            <p className="text-xs text-muted-foreground">Site occupancy</p>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {totalSiteCount - bookedSiteCount} open
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[32px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
              {occupancyPct}%
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {bookedSiteCount} of {totalSiteCount}
            </span>
          </div>
          <OccupancyBar pct={occupancyPct} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  subtitle,
  changePercent,
  changeSuffix = "vs previous",
  spark,
  accent = false,
}: {
  label: string;
  value: string;
  subtitle: string;
  // null = no prior data; show a quiet em-dash instead of a lying 0%.
  changePercent: number | null;
  changeSuffix?: string;
  spark: number[];
  accent?: boolean;
}) {
  const isPositive = (changePercent ?? 0) >= 0;
  return (
    <Card
      className={`relative overflow-hidden ${
        accent ? "bg-primary text-primary-foreground border-primary" : ""
      }`}
    >
      <CardContent className="relative p-5 space-y-3">
        <div className="flex items-start justify-between">
          <p
            className={`text-xs ${
              accent ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}
          >
            {label}
          </p>
          <Sparkline data={spark.length > 0 ? spark : [0, 0]} accent={accent} />
        </div>
        <div
          className={`text-[32px] font-semibold tabular-nums tracking-tight leading-none ${
            accent ? "text-primary-foreground" : "text-foreground"
          }`}
        >
          {value}
        </div>
        <div className="flex items-center justify-between gap-2">
          {changePercent === null ? (
            <span
              className={`text-xs tabular-nums ${
                accent ? "text-primary-foreground/70" : "text-muted-foreground/70"
              }`}
            >
              — {changeSuffix}
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-xs tabular-nums ${
                accent
                  ? isPositive
                    ? "text-primary-foreground"
                    : "text-primary-foreground"
                  : isPositive
                    ? "text-foreground"
                    : "text-destructive"
              }`}
            >
              {isPositive ? (
                <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {!isPositive && "−"}
              {Math.abs(changePercent).toFixed(1)}%
              <span
                className={
                  accent ? "text-primary-foreground/70" : "text-muted-foreground"
                }
              >
                {changeSuffix}
              </span>
            </span>
          )}
          <span
            className={`text-[11px] ${
              accent ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}
          >
            {subtitle}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function OccupancyBar({ pct }: { pct: number }) {
  // A segmented bar matching the "Progress" visual from the comps —
  // ten slots so the eye reads "6 of 10 lit" instead of a pure track.
  const lit = Math.round(pct / 10);
  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full ${
            i < lit ? "bg-primary" : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Monthly bucketing helpers (used only by this component) ────────

type Bucket = { k: string; v: number };

function bucketMonthly<T>(
  rows: T[],
  dateOf: (r: T) => string,
  valueOf: (r: T) => number,
): Bucket[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = dateOf(r);
    if (!d) continue;
    const key = d.slice(0, 7); // YYYY-MM
    map.set(key, (map.get(key) ?? 0) + valueOf(r));
  }
  return Array.from(map.entries())
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => (a.k < b.k ? -1 : 1));
}

function mergeMonthly(a: Bucket[], b: Bucket[]): Bucket[] {
  const map = new Map<string, number>();
  for (const x of a) map.set(x.k, (map.get(x.k) ?? 0) + x.v);
  for (const x of b) map.set(x.k, (map.get(x.k) ?? 0) + x.v);
  return Array.from(map.entries())
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => (a.k < b.k ? -1 : 1));
}

function diffMonthly(a: Bucket[], b: Bucket[]): Bucket[] {
  const keys = new Set<string>();
  for (const x of a) keys.add(x.k);
  for (const x of b) keys.add(x.k);
  const aMap = new Map(a.map((x) => [x.k, x.v]));
  const bMap = new Map(b.map((x) => [x.k, x.v]));
  return Array.from(keys)
    .sort()
    .map((k) => ({ k, v: (aMap.get(k) ?? 0) - (bMap.get(k) ?? 0) }));
}
