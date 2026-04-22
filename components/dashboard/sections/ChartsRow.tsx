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

function lastNMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(format(d, "MMM yy"));
  }
  return keys;
}

export async function ChartsRow({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const tDash = await getTranslations("dashboard");

  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [
    { data: twelveMonthInvoices },
    { data: twelveMonthCosts },
    { data: sixMonthPayments },
    { data: sixMonthOutflow },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("invoice_date, total_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", twelveMonthsAgo)
      .is("deleted_at", null),
    supabase
      .from("contract_payments")
      .select("payment_date, amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", twelveMonthsAgo),
    supabase
      .from("payments_received")
      .select("payment_date, amount_paise")
      .eq("organization_id", orgId)
      .gte("payment_date", sixMonthsAgo),
    supabase
      .from("contract_payments")
      .select("payment_date, amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", sixMonthsAgo),
  ]);

  // 12-month revenue + cost chart
  const monthKeys12 = lastNMonthKeys(12);
  const revenueMap = new Map<string, number>();
  for (const row of (twelveMonthInvoices ?? []) as Array<{ invoice_date: string; total_paise: number }>) {
    const key = monthKey(row.invoice_date);
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + (row.total_paise ?? 0));
  }
  const costsMap = new Map<string, number>();
  for (const row of (twelveMonthCosts ?? []) as Array<{ payment_date: string | null; amount_paid_paise: number | null }>) {
    if (!row.payment_date) continue;
    const key = monthKey(row.payment_date);
    costsMap.set(key, (costsMap.get(key) ?? 0) + (row.amount_paid_paise ?? 0));
  }
  const chartData = monthKeys12.map((month) => ({
    month,
    revenue: revenueMap.get(month) ?? 0,
    costs: costsMap.get(month) ?? 0,
  }));

  // 6-month cash flow chart
  const monthKeys6 = lastNMonthKeys(6);
  const inflowMap = new Map<string, number>();
  for (const row of (sixMonthPayments ?? []) as Array<{ payment_date: string; amount_paise: number }>) {
    const key = monthKey(row.payment_date);
    inflowMap.set(key, (inflowMap.get(key) ?? 0) + (row.amount_paise ?? 0));
  }
  const outflowMap = new Map<string, number>();
  for (const row of (sixMonthOutflow ?? []) as Array<{ payment_date: string | null; amount_paid_paise: number | null }>) {
    if (!row.payment_date) continue;
    const key = monthKey(row.payment_date);
    outflowMap.set(key, (outflowMap.get(key) ?? 0) + (row.amount_paid_paise ?? 0));
  }
  const cashFlowData = monthKeys6.map((month) => ({
    month,
    inflow: inflowMap.get(month) ?? 0,
    outflow: outflowMap.get(month) ?? 0,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("revenue_vs_cost")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RevenueCostChart data={chartData} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("cash_flow")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CashFlowChart data={cashFlowData} />
        </CardContent>
      </Card>
    </div>
  );
}
