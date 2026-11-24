// Two charts: 12-month Revenue vs Cost + 6-month Cash Flow.
// Rendered under its own Suspense boundary — slow aggregation
// queries here don't hold up KPI cards or other rows.
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  RevenueCostChart,
  CashFlowChart,
} from "@/components/dashboard/DashboardCharts";
import { getTranslations } from "next-intl/server";

function monthKey(dateStr: string): string {
  return format(parseISO(dateStr), "MMM yy");
}

// Build the list of month-labels covered by [from..to], up to a cap so
// a 10-year range doesn't turn into 120 cramped columns.
function monthKeysInRange(from: string, to: string, maxBuckets = 24): string[] {
  const start = parseISO(from);
  const end = parseISO(to);
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end && keys.length < maxBuckets) {
    keys.push(format(cursor, "MMM yy"));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

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
  const tDash = await getTranslations("dashboard");

  // Four queries in parallel. Revenue uses invoice SUBTOTAL (taxable
  // value) — GST is a pass-through and shouldn't inflate revenue.
  // Costs combine contract_payments AND paid site_expenses so the
  // charts match the KPI cards.
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

  const monthKeys = monthKeysInRange(from, to);
  const revenueMap = new Map<string, number>();
  for (const row of (rangeInvoices ?? []) as Array<{ invoice_date: string; subtotal_paise: number | null }>) {
    const key = monthKey(row.invoice_date);
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + (row.subtotal_paise ?? 0));
  }
  const costsMap = new Map<string, number>();
  for (const row of (rangeContractCosts ?? []) as Array<{ payment_date: string | null; amount_paid_paise: number | null }>) {
    if (!row.payment_date) continue;
    const key = monthKey(row.payment_date);
    costsMap.set(key, (costsMap.get(key) ?? 0) + (row.amount_paid_paise ?? 0));
  }
  for (const row of (rangeExpenseCosts ?? []) as Array<{ paid_at: string | null; amount_paise: number | null }>) {
    if (!row.paid_at) continue;
    // paid_at is a full ISO timestamptz; slice to the date before
    // bucketing so timezones can't move an expense to a different month.
    const key = monthKey(row.paid_at.slice(0, 10));
    costsMap.set(key, (costsMap.get(key) ?? 0) + (row.amount_paise ?? 0));
  }
  const chartData = monthKeys.map((month) => ({
    month,
    revenue: revenueMap.get(month) ?? 0,
    costs: costsMap.get(month) ?? 0,
  }));

  const inflowMap = new Map<string, number>();
  for (const row of (rangePayments ?? []) as Array<{ payment_date: string; amount_paise: number }>) {
    const key = monthKey(row.payment_date);
    inflowMap.set(key, (inflowMap.get(key) ?? 0) + (row.amount_paise ?? 0));
  }
  const cashFlowData = monthKeys.map((month) => ({
    month,
    inflow: inflowMap.get(month) ?? 0,
    outflow: costsMap.get(month) ?? 0,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2 space-y-0.5">
          <CardTitle className="text-base font-medium tracking-tight">
            {tDash("revenue_vs_cost")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Taxable revenue against paid cost, by month
          </p>
        </CardHeader>
        <CardContent>
          <RevenueCostChart data={chartData} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2 space-y-0.5">
          <CardTitle className="text-base font-medium tracking-tight">
            {tDash("cash_flow")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Money in from clients against money out to payees
          </p>
        </CardHeader>
        <CardContent>
          <CashFlowChart data={cashFlowData} />
        </CardContent>
      </Card>
    </div>
  );
}
