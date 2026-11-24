import { setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  ISSUED_INVOICE_STATUSES,
  OPEN_INVOICE_STATUSES,
  summariseReceivables,
} from "@/lib/receivables";
import { inr } from "@/lib/utils";
import { monthEnd, todayInIndia } from "@/lib/utils/time-buckets";
import { PageHeader } from "@/components/shared/PageHeader";
import { BillingNav } from "@/components/billing/BillingNav";
import { RevenueChart } from "@/components/billing/RevenueChart";

export const metadata = { title: "Financial Reports" };

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Last 12 months, ending with the current month in India.
  const today = todayInIndia();
  const [year, month] = today.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(year, month - 12 + i, 1)).toISOString().slice(0, 7),
  );
  const fromDate = `${months[0]}-01`;
  // Not "-31": in a 30-day month that isn't a date, every query below fails
  // and the whole report reads ₹0.
  const toDate = monthEnd(today);

  const [invoicesResult, paymentsResult, rentResult, requestsResult, openResult] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("invoice_date, status, total_paise, cgst_paise, sgst_paise, igst_paise")
        .in("status", ISSUED_INVOICE_STATUSES)
        .gte("invoice_date", fromDate)
        .lte("invoice_date", toDate)
        .is("deleted_at", null),
      supabase
        .from("payments_received")
        .select("payment_date, amount_paise")
        .gte("payment_date", fromDate)
        .lte("payment_date", toDate),
      // Money out has two streams, as on the dashboard: rent paid on contracts
      // and settled payment requests. Leaving one out would overstate the net.
      supabase
        .from("contract_payments")
        .select("payment_date, amount_paid_paise, tds_deducted_paise")
        .eq("status", "paid")
        .gte("payment_date", fromDate)
        .lte("payment_date", toDate),
      supabase
        .from("site_expenses")
        .select("paid_at, amount_paise")
        .eq("status", "paid")
        .gte("paid_at", `${fromDate}T00:00:00Z`)
        .lte("paid_at", `${toDate}T23:59:59Z`)
        .is("deleted_at", null),
      supabase
        .from("invoices")
        .select("balance_due_paise, due_date, status")
        .in("status", OPEN_INVOICE_STATUSES)
        .is("deleted_at", null),
    ]);

  // A report with a missing part would show wrong totals, so show none.
  const failed = [invoicesResult, paymentsResult, rentResult, requestsResult, openResult]
    .find((r) => r.error);
  if (failed) {
    console.error("[billing reports] could not load:", failed.error?.message);
    return (
      <div>
        <PageHeader
          eyebrow="Billing"
          title="Financial Reports"
          description="Revenue, collections, payables and GST for the last 12 months."
        />
        <BillingNav />
        <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load the report. Refresh to try again.
        </p>
      </div>
    );
  }

  // Build monthly series
  type MonthData = {
    month: string;
    label: string;
    invoiced: number;
    collected: number;
    paid_out: number;
    cgst: number;
    sgst: number;
    igst: number;
  };

  const monthMap = new Map<string, MonthData>(
    months.map((m) => [m, { month: m, label: monthLabel(m), invoiced: 0, collected: 0, paid_out: 0, cgst: 0, sgst: 0, igst: 0 }])
  );

  // Monthly table: GST on what was invoiced. The GST card below counts only
  // paid invoices, as its title says.
  const gstPaid = { cgst: 0, sgst: 0, igst: 0 };
  for (const inv of invoicesResult.data ?? []) {
    const row = monthMap.get(inv.invoice_date.slice(0, 7));
    if (row) {
      row.invoiced += inv.total_paise ?? 0;
      row.cgst += inv.cgst_paise ?? 0;
      row.sgst += inv.sgst_paise ?? 0;
      row.igst += inv.igst_paise ?? 0;
    }
    if (inv.status === "paid") {
      gstPaid.cgst += inv.cgst_paise ?? 0;
      gstPaid.sgst += inv.sgst_paise ?? 0;
      gstPaid.igst += inv.igst_paise ?? 0;
    }
  }

  for (const p of paymentsResult.data ?? []) {
    const row = monthMap.get(p.payment_date.slice(0, 7));
    if (row) row.collected += p.amount_paise ?? 0;
  }

  for (const p of rentResult.data ?? []) {
    if (!p.payment_date) continue;
    const row = monthMap.get(p.payment_date.slice(0, 7));
    if (row) row.paid_out += (p.amount_paid_paise ?? 0) - (p.tds_deducted_paise ?? 0);
  }
  for (const e of requestsResult.data ?? []) {
    if (!e.paid_at) continue;
    const row = monthMap.get(e.paid_at.slice(0, 7));
    if (row) row.paid_out += e.amount_paise ?? 0;
  }

  const monthlyData = Array.from(monthMap.values());

  // Summary totals (all time for the 12M range)
  const totalInvoiced = monthlyData.reduce((s, m) => s + m.invoiced, 0);
  const totalCollected = monthlyData.reduce((s, m) => s + m.collected, 0);
  const totalPaidOut = monthlyData.reduce((s, m) => s + m.paid_out, 0);
  const totalCgst = monthlyData.reduce((s, m) => s + m.cgst, 0);
  const totalSgst = monthlyData.reduce((s, m) => s + m.sgst, 0);
  const totalIgst = monthlyData.reduce((s, m) => s + m.igst, 0);

  const receivables = summariseReceivables(openResult.data ?? [], today);

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Financial Reports"
        description="Revenue, collections, payables and GST for the last 12 months."
      />

      <BillingNav />

      {/* KPI Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="12M Invoiced" value={inr(totalInvoiced)} hint="Including GST" />
        <KpiTile label="12M Collected" value={inr(totalCollected)} tone="success" />
        <KpiTile label="12M Paid Out" value={inr(totalPaidOut)} tone="danger" hint="Rent and payment requests" />
        <KpiTile
          label="Net (Collected − Paid)"
          value={inr(totalCollected - totalPaidOut)}
          tone={totalCollected - totalPaidOut >= 0 ? "success" : "danger"}
        />
      </div>

      {/* Revenue Chart */}
      <div className="mb-5 rounded-2xl border border-border bg-card card-elevated p-5">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          Monthly Revenue vs Collections (Last 12 Months)
        </h2>
        <RevenueChart data={monthlyData} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* GST Summary */}
        <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden">
          <div className="border-b border-border bg-muted/30 px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">GST Summary (12M, Paid Invoices)</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              <tr className="hover:bg-muted/20">
                <td className="px-4 py-3">CGST Collected</td>
                <td className="px-4 py-3 text-right font-medium">{inr(gstPaid.cgst)}</td>
              </tr>
              <tr className="hover:bg-muted/20">
                <td className="px-4 py-3">SGST Collected</td>
                <td className="px-4 py-3 text-right font-medium">{inr(gstPaid.sgst)}</td>
              </tr>
              <tr className="hover:bg-muted/20">
                <td className="px-4 py-3">IGST Collected</td>
                <td className="px-4 py-3 text-right font-medium">{inr(gstPaid.igst)}</td>
              </tr>
              <tr className="bg-muted/30 font-bold">
                <td className="px-4 py-3">Total GST</td>
                <td className="px-4 py-3 text-right">{inr(gstPaid.cgst + gstPaid.sgst + gstPaid.igst)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Receivables vs Payables */}
        <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden">
          <div className="border-b border-border bg-muted/30 px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">Receivables vs Payables</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              <tr className="hover:bg-muted/20">
                <td className="px-4 py-3">Outstanding Receivables</td>
                <td className="px-4 py-3 text-right font-medium text-red-600">{inr(receivables.outstanding)}</td>
              </tr>
              <tr className="hover:bg-muted/20">
                <td className="px-4 py-3">Of which overdue</td>
                <td className="px-4 py-3 text-right font-medium text-red-600">{inr(receivables.overdue)}</td>
              </tr>
              <tr className="hover:bg-muted/20">
                <td className="px-4 py-3 text-muted-foreground text-xs" colSpan={2}>
                  (Sent and partially paid invoices)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Monthly Breakdown</h2>
          <a
            href={`/api/billing/reports/csv?from=${fromDate}&to=${toDate}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Export CSV
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                {["Month", "Invoiced", "Collected", "CGST", "SGST", "IGST", "Paid Out", "Net"].map((h) => (
                  <th key={h} className={`px-4 py-3 font-medium text-muted-foreground ${h === "Month" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {monthlyData.map((m) => (
                <tr key={m.month} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{m.label}</td>
                  <td className="px-4 py-3 text-right">{m.invoiced > 0 ? inr(m.invoiced) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-right text-green-600">{m.collected > 0 ? inr(m.collected) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{m.cgst > 0 ? inr(m.cgst) : "—"}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{m.sgst > 0 ? inr(m.sgst) : "—"}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{m.igst > 0 ? inr(m.igst) : "—"}</td>
                  <td className="px-4 py-3 text-right text-red-600">{m.paid_out > 0 ? inr(m.paid_out) : <span className="text-muted-foreground">—</span>}</td>
                  <td className={`px-4 py-3 text-right font-medium ${m.collected - m.paid_out > 0 ? "text-green-600" : m.collected - m.paid_out < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                    {m.collected > 0 || m.paid_out > 0 ? inr(m.collected - m.paid_out) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 font-bold">
              <tr>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right">{inr(totalInvoiced)}</td>
                <td className="px-4 py-3 text-right text-green-600">{inr(totalCollected)}</td>
                <td className="px-4 py-3 text-right">{inr(totalCgst)}</td>
                <td className="px-4 py-3 text-right">{inr(totalSgst)}</td>
                <td className="px-4 py-3 text-right">{inr(totalIgst)}</td>
                <td className="px-4 py-3 text-right text-red-600">{inr(totalPaidOut)}</td>
                <td className={`px-4 py-3 text-right ${totalCollected - totalPaidOut >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {inr(totalCollected - totalPaidOut)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
