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

  // Previous-period comparison. When there's no prior data we hide
  // the delta row entirely rather than show a misleading "+0.0%" with
  // an up-arrow — a dashboard that lies about its own change is worse
  // than one that admits it doesn't know yet.
  const hasRevenueDelta = lastMonthRevenue > 0;
  const hasCostDelta = lastMonthCostTotal > 0;
  const invoiceCount = thisMonthInvoices?.length ?? 0;

  // Layout: Revenue is the hero, taking the left 2 columns on wide
  // screens. The other three figures stack on the right as compact
  // ledger rows. This is the ONE typographic moment on the row —
  // serif period eyebrow + a very large sans figure + an inline
  // delta. Everything else reads as supporting detail.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      {/* ─── Hero: Revenue ─────────────────────────────────────── */}
      <Card className="relative overflow-hidden xl:col-span-2 hero-surface border-primary/15">
        <CardContent className="relative p-6 md:p-7">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-[1px] w-5 bg-primary/70"
            />
            <p className="font-display italic text-[13px] text-primary/85">
              Revenue
            </p>
          </div>
          <div className="mt-4 text-[44px] md:text-[52px] font-normal tabular-nums tracking-tight text-foreground leading-[0.95]">
            {inr(thisMonthRevenue)}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs">
            <DeltaPill
              changePercent={hasRevenueDelta ? revenueChange : null}
              label="vs previous period"
            />
          </div>
          <div className="rule-hair mt-6" />
          <div className="mt-4 grid grid-cols-2 gap-6">
            <LedgerCell
              label="Invoices in window"
              value={String(invoiceCount)}
              footnote={invoiceCount === 1 ? "single bill" : "billed, GST excluded"}
            />
            <LedgerCell
              label="Average per invoice"
              value={inr(
                invoiceCount > 0
                  ? Math.round(thisMonthRevenue / invoiceCount)
                  : 0,
              )}
              footnote={
                invoiceCount === 0 ? "no billing yet" : "across the window"
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Supporting ledger stats ──────────────────────────── */}
      <Card className="relative overflow-hidden xl:col-span-3">
        <CardContent className="relative p-6 md:p-7 space-y-5">
          <LedgerRow
            title="Cost"
            value={inr(thisMonthCostTotal)}
            hint="Rent paid + settled requests"
            // Lower cost is a good thing, so flip the sign for the colour.
            changePercent={hasCostDelta ? -costChange : null}
            changeLabel="vs previous period"
          />
          <div className="rule-hair" />
          <LedgerRow
            title="Net profit"
            value={inr(netProfit)}
            hint="Taxable revenue minus cost"
            // Keeps its real sign — a loss shows a down arrow.
            changePercent={thisMonthRevenue > 0 ? profitMargin : null}
            changeLabel="margin"
          />
          <div className="rule-hair" />
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground tracking-wide">
                {tDash("site_occupancy")}
              </p>
              <div className="flex items-baseline gap-2.5">
                <span className="text-[28px] font-normal tabular-nums tracking-tight text-foreground leading-none">
                  {occupancyPct}%
                </span>
                <span className="font-display italic text-xs text-muted-foreground">
                  {bookedSiteCount} of {totalSiteCount}
                </span>
              </div>
            </div>
            <div className="w-40">
              <Progress value={occupancyPct} className="h-1" />
              <p className="mt-2 text-[11px] text-muted-foreground tracking-wide tabular-nums text-right">
                {totalSiteCount - bookedSiteCount} available
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Ledger primitives ──────────────────────────────────────────────

// LedgerRow — one line on the right-hand supporting card. Title left,
// figure right, delta underneath. Reads like a line in a ledger
// instead of a stacked KPI tile.
function LedgerRow({
  title,
  value,
  hint,
  changePercent,
  changeLabel,
}: {
  title: string;
  value: string;
  hint?: string;
  changePercent: number | null;
  changeLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground tracking-wide">{title}</p>
        {hint && (
          <p className="font-display italic text-xs text-muted-foreground/80">
            {hint}
          </p>
        )}
      </div>
      <div className="text-right space-y-1">
        <div className="text-[26px] font-normal tabular-nums tracking-tight text-foreground leading-none">
          {value}
        </div>
        <div className="flex justify-end">
          <DeltaPill
            changePercent={changePercent}
            label={changeLabel}
            compact
          />
        </div>
      </div>
    </div>
  );
}

// LedgerCell — two small stats inside the hero tile, under the rule.
// Reads like the two footnotes to a running total.
function LedgerCell({
  label,
  value,
  footnote,
}: {
  label: string;
  value: string;
  footnote?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground tracking-wide">{label}</p>
      <p className="text-base font-normal tabular-nums text-foreground leading-tight">
        {value}
      </p>
      {footnote && (
        <p className="font-display italic text-[11px] text-muted-foreground">
          {footnote}
        </p>
      )}
    </div>
  );
}

// DeltaPill — the trend arrow + magnitude. Hidden when there's no
// prior-period data (shows a quiet em-dash instead of a lying 0%).
function DeltaPill({
  changePercent,
  label,
  compact = false,
}: {
  changePercent: number | null;
  label: string;
  compact?: boolean;
}) {
  if (changePercent === null) {
    return (
      <span className="text-[11px] text-muted-foreground/70 tracking-wide">
        — {label}
      </span>
    );
  }
  const isPositive = changePercent >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-2 text-[11px] tracking-wide">
      <span
        className={`inline-flex items-center gap-1 tabular-nums ${
          isPositive ? "text-foreground" : "text-destructive"
        }`}
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} />
        {!isPositive && "−"}
        {Math.abs(changePercent).toFixed(1)}%
      </span>
      {!compact && <span className="text-muted-foreground">{label}</span>}
      {compact && (
        <span className="text-muted-foreground font-display italic">
          {label}
        </span>
      )}
    </span>
  );
}
