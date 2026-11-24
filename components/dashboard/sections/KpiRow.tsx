// KPI row — top-of-dashboard strip with 4 cards:
//   Revenue this month, Costs this month, Net profit, Site occupancy.
//
// Renders as an async Server Component so it can be wrapped in its own
// Suspense boundary. Each row (KpiRow, ChartsRow, SecondaryRow, etc.)
// fetches its own slice of data independently — slow queries in one
// row can't block the others from painting.
//
// Revenue is the invoice TAXABLE VALUE (subtotal), not the GST-
// inclusive grand total — GST is a pass-through and shouldn't inflate
// top-line revenue. Costs combine two streams: contract_payments
// (status=paid, by payment_date) and site_expenses (status=paid, by
// paid_at) — the finance team pays rent through contracts AND files
// one-off payment requests, and the dashboard has to see both.
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

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
  const tDash = await getTranslations("dashboard");

  // Compute the equally-long window immediately preceding `from`..`to`
  // for the "vs previous period" comparison line on each KPI card.
  // So "This month" compares to "Last month", "This FY" to "Last FY",
  // and a custom 14-day range compares to the 14 days before that.
  const MS_PER_DAY = 86_400_000;
  const fromMs = Date.parse(from + "T00:00:00Z");
  const toMs = Date.parse(to + "T00:00:00Z");
  const spanDays = Math.max(
    1,
    Math.floor((toMs - fromMs) / MS_PER_DAY) + 1,
  );
  const prevToDate = new Date(fromMs - MS_PER_DAY);
  const prevFromDate = new Date(fromMs - spanDays * MS_PER_DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const prevFrom = iso(prevFromDate);
  const prevTo = iso(prevToDate);
  // site_expenses.paid_at is timestamptz; widen both ends of the
  // range to the full day so a payment stamped at 23:30 IST on `to`
  // still counts.
  const paidFromTs = `${from}T00:00:00Z`;
  const paidToTs = `${to}T23:59:59Z`;
  const prevPaidFromTs = `${prevFrom}T00:00:00Z`;
  const prevPaidToTs = `${prevTo}T23:59:59Z`;

  // Eight small queries, all in parallel — row paints as fast as the
  // slowest. The site_expenses pair joins contract_payments for the
  // total cost; splitting the queries keeps each one trivially
  // indexable and the server-side joins out of the hot path.
  const [
    { data: thisMonthInvoices },
    { data: lastMonthInvoices },
    { data: thisMonthContractCosts },
    { data: lastMonthContractCosts },
    { data: thisMonthExpenseCosts },
    { data: lastMonthExpenseCosts },
    { data: allSites },
    { data: bookedSites },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("subtotal_paise")
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
      .select("amount_paid_paise")
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
    // Paid payment requests — the second cost stream. paid_at is
    // timestamptz; tds_paise (when recorded) stays out of the cost
    // because tds is withheld from the payee, not an outflow.
    supabase
      .from("site_expenses")
      .select("amount_paise")
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
    // Sites in the "available pool" — counted in the occupancy
    // denominator. Excludes maintenance / blocked / expired so a
    // structure under repair doesn't drag the % down.
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

  const thisMonthRevenue = sumPaise(thisMonthInvoices, "subtotal_paise");
  const lastMonthRevenue = sumPaise(lastMonthInvoices, "subtotal_paise");
  const thisMonthCostTotal =
    sumPaise(thisMonthContractCosts, "amount_paid_paise") +
    sumPaise(thisMonthExpenseCosts, "amount_paise");
  const lastMonthCostTotal =
    sumPaise(lastMonthContractCosts, "amount_paid_paise") +
    sumPaise(lastMonthExpenseCosts, "amount_paise");

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

  // Previous-period comparison. When there's no prior data (fresh FY,
  // empty window) we hide the delta row entirely rather than show a
  // misleading "+0.0%" with an up-arrow — a dashboard that lies about
  // its own change is worse than one that admits it doesn't know yet.
  const hasRevenueDelta = lastMonthRevenue > 0;
  const hasCostDelta = lastMonthCostTotal > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard
        title="Revenue"
        value={inr(thisMonthRevenue)}
        hint={`Taxable value · ${thisMonthInvoices?.length ?? 0} invoices`}
        changePercent={hasRevenueDelta ? revenueChange : null}
        changeLabel="vs previous period"
      />
      <KpiCard
        title="Cost"
        value={inr(thisMonthCostTotal)}
        hint="Rent paid + settled requests"
        // On cost, a NEGATIVE change is a good thing, so we flip the
        // sign so "lower cost" reads as an up-tick.
        changePercent={hasCostDelta ? -costChange : null}
        changeLabel="vs previous period"
      />
      <KpiCard
        title="Net profit"
        value={inr(netProfit)}
        hint="Taxable revenue − cost"
        // Margin keeps its real sign: a loss shows a down arrow with
        // the magnitude, not an up arrow with the absolute value.
        changePercent={thisMonthRevenue > 0 ? profitMargin : null}
        changeLabel="margin"
      />
      <Card className="relative overflow-hidden">
        <CardContent className="relative pt-6">
          <p className="text-xs text-muted-foreground">
            {tDash("site_occupancy")}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-[28px] font-medium tabular-nums tracking-tight text-foreground leading-none">
              {occupancyPct}%
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {bookedSiteCount} of {totalSiteCount} sites
            </div>
          </div>
          <Progress value={occupancyPct} className="mt-4 h-1" />
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  changePercent,
  changeLabel,
}: {
  title: string;
  value: string;
  hint?: string;
  // null = no prior-period data; render the row quiet instead of a
  // fake 0.0% with a green arrow. Numbers may be negative — the sign
  // decides the arrow and the colour.
  changePercent: number | null;
  changeLabel: string;
}) {
  const isPositive = (changePercent ?? 0) >= 0;
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="relative pt-6">
        <p className="text-xs text-muted-foreground">{title}</p>
        <div className="mt-2 text-[28px] font-medium tabular-nums tracking-tight text-foreground leading-none">
          {value}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs">
          {changePercent === null ? (
            <span className="text-muted-foreground/70 tabular-nums">
              — {changeLabel}
            </span>
          ) : (
            <>
              <span
                className={`inline-flex items-center gap-1 tabular-nums ${
                  isPositive ? "text-foreground" : "text-destructive"
                }`}
              >
                {isPositive ? (
                  <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                {!isPositive && "−"}
                {Math.abs(changePercent).toFixed(1)}%
              </span>
              <span className="text-muted-foreground">{changeLabel}</span>
            </>
          )}
        </div>
        {hint && (
          <p className="mt-2 text-[11px] text-muted-foreground/80">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
