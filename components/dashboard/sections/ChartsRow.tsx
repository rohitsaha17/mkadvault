// Two charts: revenue vs cost, and cash flow. Own Suspense boundary, so slow
// aggregation here never holds up the KPI cards.
import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CashFlowChart,
  RevenueCostChart,
} from "@/components/dashboard/DashboardCharts";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import {
  bucketUnit,
  buildTimeBuckets,
  sumIntoBuckets,
  todayInIndia,
} from "@/lib/utils/time-buckets";

export async function ChartsRow({
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

  // Revenue uses invoice SUBTOTAL (taxable value) — GST is a pass-through.
  // Costs combine contract_payments AND paid site_expenses so the charts
  // match the KPI cards.
  const [
    { data: rangeInvoices },
    { data: rangeContractCosts },
    { data: rangeExpenseCosts },
    { data: rangePayments },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("invoice_date, subtotal_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .is("deleted_at", null),
    supabase
      .from("contract_payments")
      .select("payment_date, amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", from)
      .lte("payment_date", to),
    supabase
      .from("site_expenses")
      .select("paid_at, amount_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("paid_at", `${from}T00:00:00Z`)
      .lte("paid_at", `${to}T23:59:59Z`)
      .is("deleted_at", null),
    supabase
      .from("payments_received")
      .select("payment_date, amount_paise")
      .eq("organization_id", orgId)
      .gte("payment_date", from)
      .lte("payment_date", to),
  ]);

  const toRows = (
    rows: Array<Record<string, unknown>> | null,
    dateKey: string,
    valueKey: string,
  ) =>
    (rows ?? []).map((r) => ({
      date: r[dateKey] as string | null,
      value: (r[valueKey] as number | null) ?? 0,
    }));

  const buckets = buildTimeBuckets({
    from,
    to,
    today: todayInIndia(),
    locale,
  });
  const revenueRows = toRows(rangeInvoices, "invoice_date", "subtotal_paise");
  const costRows = [
    ...toRows(rangeContractCosts, "payment_date", "amount_paid_paise"),
    ...toRows(rangeExpenseCosts, "paid_at", "amount_paise"),
  ];
  const inflowRows = toRows(rangePayments, "payment_date", "amount_paise");
  const revenue = sumIntoBuckets(buckets, revenueRows);
  const cost = sumIntoBuckets(buckets, costRows);
  const inflow = sumIntoBuckets(buckets, inflowRows);

  // Legend totals come from the rows, not the bars, so they match the KPI
  // cards even when a very long range only draws its most recent months.
  const total = (rows: Array<{ value: number }>) =>
    rows.reduce((s, r) => s + r.value, 0);

  // A future bucket is null unless something is already dated into it (an
  // advance invoice, for example), which is worth showing.
  const point = (value: number, future: boolean) =>
    future && value === 0 ? null : value;

  const grain =
    buckets[0] && buckets[0].start > from
      ? t("last_n_months", { count: buckets.length })
      : {
          day: t("by_day"),
          week: t("by_week"),
          month: t("by_month"),
        }[bucketUnit(from, to)];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Card className="rounded-3xl xl:col-span-3">
        <ChartHeader
          title={t("revenue_vs_cost")}
          subtitle={`${t("revenue_vs_cost_sub")} · ${grain}`}
          legend={[
            {
              label: t("revenue"),
              value: inr(total(revenueRows)),
              swatch: "bg-chart-1",
            },
            {
              label: t("cost"),
              value: inr(total(costRows)),
              swatch: "bg-chart-2",
            },
          ]}
        />
        <CardContent>
          <RevenueCostChart
            data={buckets.map((b, i) => ({
              label: b.label,
              revenue: point(revenue[i], b.future),
              cost: point(cost[i], b.future),
            }))}
            labels={{
              caption: t("revenue_vs_cost"),
              revenue: t("revenue"),
              cost: t("cost"),
              net: t("net"),
            }}
          />
        </CardContent>
      </Card>

      <Card className="rounded-3xl xl:col-span-2">
        <ChartHeader
          title={t("cash_flow")}
          subtitle={`${t("cash_flow_sub")} · ${grain}`}
          legend={[
            {
              label: t("inflow"),
              value: inr(total(inflowRows)),
              swatch: "bg-chart-1",
            },
            {
              label: t("outflow"),
              value: inr(total(costRows)),
              swatch: "bg-chart-2",
            },
          ]}
        />
        <CardContent>
          <CashFlowChart
            data={buckets.map((b, i) => ({
              label: b.label,
              inflow: point(inflow[i], b.future),
              outflow: point(cost[i], b.future),
            }))}
            labels={{
              caption: t("cash_flow"),
              inflow: t("inflow"),
              outflow: t("outflow"),
              net: t("net"),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ChartHeader({
  title,
  subtitle,
  legend,
}: {
  title: string;
  subtitle: string;
  legend: Array<{ label: string; value: string; swatch: string }>;
}) {
  return (
    <CardHeader className="gap-4">
      <div className="space-y-1">
        <CardTitle className="text-xl">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {legend.map((item) => (
          <li key={item.label}>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden
                className={`size-2.5 rounded-[3px] ${item.swatch}`}
              />
              {item.label}
            </span>
            <span className="figure mt-1.5 block text-xl text-foreground">
              {item.value}
            </span>
          </li>
        ))}
      </ul>
    </CardHeader>
  );
}
