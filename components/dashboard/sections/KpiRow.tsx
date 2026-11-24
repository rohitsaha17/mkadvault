// KPI row — revenue, cost, net profit and site occupancy for the range.
//
// Revenue is the invoice TAXABLE VALUE (subtotal), not the GST-inclusive
// grand total — GST is a pass-through and shouldn't inflate the top line.
// Cost combines two streams: contract_payments (status=paid, by payment_date)
// and site_expenses (status=paid, by paid_at), because the finance team pays
// rent through contracts AND files one-off payment requests.
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IconTile, type IconName } from "@/components/dashboard/IconTile";
import { MiniBars, type MiniBar } from "@/components/dashboard/MiniBars";
import { RingMeter } from "@/components/dashboard/RingMeter";
import { createClient } from "@/lib/supabase/server";
import { cn, inr } from "@/lib/utils";
import {
  buildTimeBuckets,
  sumIntoBuckets,
  todayInIndia,
} from "@/lib/utils/time-buckets";

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
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  // The equally long window immediately before `from`..`to`, so "This month"
  // compares to "Last month" and a custom 14-day range to the 14 days before.
  const MS_PER_DAY = 86_400_000;
  const fromMs = Date.parse(from + "T00:00:00Z");
  const toMs = Date.parse(to + "T00:00:00Z");
  const spanDays = Math.max(1, Math.floor((toMs - fromMs) / MS_PER_DAY) + 1);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const prevFrom = iso(fromMs - spanDays * MS_PER_DAY);
  const prevTo = iso(fromMs - MS_PER_DAY);
  // site_expenses.paid_at is timestamptz, so widen both ends to the full day.
  const dayStart = (date: string) => `${date}T00:00:00Z`;
  const dayEnd = (date: string) => `${date}T23:59:59Z`;

  // Eight small queries in parallel — the row paints as fast as the slowest.
  const [
    { data: invoices },
    { data: prevInvoices },
    { data: contractCosts },
    { data: prevContractCosts },
    { data: expenseCosts },
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
    // tds_paise stays out of the cost: it is withheld from the payee, not an
    // extra outflow.
    supabase
      .from("site_expenses")
      .select("amount_paise, paid_at")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", dayStart(from))
      .lte("paid_at", dayEnd(to))
      .is("deleted_at", null),
    supabase
      .from("site_expenses")
      .select("amount_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", dayStart(prevFrom))
      .lte("paid_at", dayEnd(prevTo))
      .is("deleted_at", null),
    // The occupancy denominator leaves out maintenance / blocked / expired so
    // a structure under repair doesn't drag the percentage down.
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

  const revenue = sumPaise(invoices, "subtotal_paise");
  const prevRevenue = sumPaise(prevInvoices, "subtotal_paise");
  const cost =
    sumPaise(contractCosts, "amount_paid_paise") +
    sumPaise(expenseCosts, "amount_paise");
  const prevCost =
    sumPaise(prevContractCosts, "amount_paid_paise") +
    sumPaise(prevExpenseCosts, "amount_paise");
  const netProfit = revenue - cost;
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : null;
  // null = nothing to compare with, which reads very differently from 0%.
  const change = (now: number, before: number) =>
    before > 0 ? ((now - before) / before) * 100 : null;

  const totalSites = (allSites ?? []).length;
  const bookedCount = (bookedSites ?? []).length;
  const occupancy =
    totalSites > 0 ? Math.round((bookedCount / totalSites) * 100) : 0;

  // ── Mini charts ───────────────────────────────────────────────────────────
  const buckets = buildTimeBuckets({
    from,
    to,
    today: todayInIndia(),
    locale,
  });
  const revenueSeries = sumIntoBuckets(
    buckets,
    (invoices ?? []).map((r) => ({
      date: r.invoice_date as string | null,
      value: (r.subtotal_paise as number | null) ?? 0,
    })),
  );
  const costSeries = sumIntoBuckets(buckets, [
    ...(contractCosts ?? []).map((r) => ({
      date: r.payment_date as string | null,
      value: (r.amount_paid_paise as number | null) ?? 0,
    })),
    ...(expenseCosts ?? []).map((r) => ({
      date: r.paid_at as string | null,
      value: (r.amount_paise as number | null) ?? 0,
    })),
  ]);
  const toBars = (series: number[]): MiniBar[] =>
    buckets.map((b, i) => ({
      label: b.label,
      value: series[i],
      display: money(series[i]),
      current: b.current,
      future: b.future,
    }));
  const summary = (name: string, total: number) =>
    t("trend_summary", { name, total: money(total) });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon="coins"
        label={t("revenue")}
        value={money(revenue)}
        sub={t("revenue_sub", { count: invoices?.length ?? 0 })}
        lime
        delta={
          <Delta
            change={change(revenue, prevRevenue)}
            goodWhen="up"
            noData={t("no_previous")}
            suffix={t("vs_previous")}
            lime
          />
        }
        chart={
          <MiniBars
            bars={toBars(revenueSeries)}
            tone="ink"
            summary={summary(t("revenue"), revenue)}
          />
        }
      />
      <KpiCard
        icon="receipt"
        label={t("cost")}
        value={money(cost)}
        sub={t("cost_sub")}
        delta={
          <Delta
            change={change(cost, prevCost)}
            goodWhen="down"
            noData={t("no_previous")}
            suffix={t("vs_previous")}
          />
        }
        chart={
          <MiniBars
            bars={toBars(costSeries)}
            tone="neutral"
            summary={summary(t("cost"), cost)}
          />
        }
      />
      <KpiCard
        icon="growth"
        label={t("net_profit")}
        value={money(netProfit)}
        sub={t("profit_sub")}
        delta={
          margin === null ? null : (
            <span
              className={cn(
                "text-xs font-medium",
                margin < 0 ? "text-destructive" : "text-primary",
              )}
            >
              {t("margin_value", { value: signed(margin) })}
            </span>
          )
        }
        chart={
          <MiniBars
            bars={toBars(revenueSeries.map((v, i) => v - costSeries[i]))}
            tone="signed"
            summary={summary(t("net_profit"), netProfit)}
          />
        }
      />
      <Card className="justify-between gap-4 rounded-3xl p-5 py-5">
        <CardTop icon="hoarding" label={t("site_occupancy")} />
        <div className="flex items-center gap-5">
          <RingMeter
            percent={occupancy}
            label={t("sites_booked", {
              booked: bookedCount,
              total: totalSites,
            })}
          />
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2.5 rounded-full bg-chart-1" />
                {t("booked")}
              </dt>
              <dd className="figure mt-1 text-xl">{bookedCount}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2.5 rounded-full bg-chart-1/20 ring-1 ring-inset ring-chart-1/40" />
                {t("open")}
              </dt>
              <dd className="figure mt-1 text-xl">
                {totalSites - bookedCount}
              </dd>
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Rupees with a true minus sign, so a loss lines up with positive figures. */
function money(paise: number): string {
  return inr(paise).replace("-", "−");
}

function signed(percent: number): string {
  return `${percent < 0 ? "−" : ""}${Math.abs(percent).toFixed(1)}`;
}

function CardTop({
  icon,
  label,
  lime = false,
}: {
  icon: IconName;
  label: string;
  lime?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p
        className={cn(
          "pt-1 text-sm font-medium",
          lime ? "text-ink/80" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <IconTile name={icon} />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  delta,
  chart,
  lime = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  delta: React.ReactNode;
  chart: React.ReactNode;
  lime?: boolean;
}) {
  const content = (
    <>
      <CardTop icon={icon} label={label} lime={lime} />
      <div>
        <p
          className={cn(
            "figure text-[32px]",
            lime ? "text-ink" : "text-foreground",
          )}
        >
          {value}
        </p>
        <div className="mt-2.5 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1">
          {delta}
        </div>
        <p
          className={cn(
            "mt-1 text-xs",
            lime ? "text-ink/70" : "text-muted-foreground",
          )}
        >
          {sub}
        </p>
      </div>
      {chart}
    </>
  );

  if (lime) {
    return (
      <div className="lime-surface flex flex-col justify-between gap-4 rounded-3xl p-5 text-ink">
        {content}
      </div>
    );
  }
  return (
    <Card className="justify-between gap-4 rounded-3xl p-5 py-5">{content}</Card>
  );
}

// The arrow always shows the true direction; only the colour says whether
// that direction is good. A rising cost points up and turns red.
function Delta({
  change,
  goodWhen,
  noData,
  suffix,
  lime = false,
}: {
  change: number | null;
  goodWhen: "up" | "down";
  noData: string;
  suffix: string;
  lime?: boolean;
}) {
  if (change === null) {
    return (
      <span
        className={cn(
          "text-xs",
          lime ? "text-ink/70" : "text-muted-foreground",
        )}
      >
        {noData}
      </span>
    );
  }
  const up = change >= 0;
  const good = up === (goodWhen === "up");
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold",
          lime
            ? "bg-ink/12 text-ink"
            : good
              ? "bg-primary/15 text-primary"
              : "bg-destructive/12 text-destructive",
        )}
      >
        <Arrow className="size-3.5" strokeWidth={2.25} aria-hidden />
        {signed(change)}%
      </span>
      <span
        className={cn(
          "text-xs",
          lime ? "text-ink/70" : "text-muted-foreground",
        )}
      >
        {suffix}
      </span>
    </>
  );
}
