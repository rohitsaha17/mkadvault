import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inr, fmt } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BillingNav } from "@/components/billing/BillingNav";

export const metadata = { title: "Receivables" };

function daysPast(dueDate: string): number {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}

function agingBucket(dueDate: string | null): "current" | "31-60" | "61-90" | "90+" {
  if (!dueDate) return "current";
  const days = daysPast(dueDate);
  if (days <= 30) return "current";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  balance_due_paise: number;
  total_paise: number;
  amount_paid_paise: number;
  status: string;
  client_id: string;
  client_name: string;
}

interface ClientAging {
  client_id: string;
  client_name: string;
  current: number;
  "31-60": number;
  "61-90": number;
  "90+": number;
  total: number;
  invoices: InvoiceRow[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReceivablesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const weekFromNowDate = new Date(); weekFromNowDate.setDate(weekFromNowDate.getDate() + 7);
  const weekFromNow = weekFromNowDate.toISOString().slice(0, 10);

  // Fetch all outstanding invoices (sent + partially_paid + overdue)
  const { data: outstandingData } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, due_date,
      balance_due_paise, total_paise, amount_paid_paise, status,
      client_id,
      client:clients(company_name)
    `)
    .in("status", ["sent", "partially_paid", "overdue"])
    .is("deleted_at", null)
    .order("due_date", { ascending: true });

  // Fetch collected this month
  const { data: collectedData } = await supabase
    .from("payments_received")
    .select("amount_paise")
    .gte("payment_date", `${thisMonth}-01`)
    .lte("payment_date", `${thisMonth}-31`);

  // Fetch due this week
  const { data: dueThisWeek } = await supabase
    .from("invoices")
    .select("balance_due_paise")
    .in("status", ["sent", "partially_paid"])
    .gte("due_date", today)
    .lte("due_date", weekFromNow)
    .is("deleted_at", null);

  const invoices: InvoiceRow[] = (outstandingData ?? []).map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    due_date: inv.due_date,
    balance_due_paise: inv.balance_due_paise ?? 0,
    total_paise: inv.total_paise ?? 0,
    amount_paid_paise: inv.amount_paid_paise ?? 0,
    status: inv.status,
    client_id: inv.client_id,
    client_name: (inv.client as unknown as { company_name: string } | null)?.company_name ?? "Unknown",
  }));

  // Aggregate stats
  const totalOutstanding = invoices.reduce((s, i) => s + i.balance_due_paise, 0);
  const overdueTotal = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + i.balance_due_paise, 0);
  const collectedThisMonth = (collectedData ?? []).reduce((s, p) => s + (p.amount_paise ?? 0), 0);
  const dueThisWeekTotal = (dueThisWeek ?? []).reduce((s, i) => s + (i.balance_due_paise ?? 0), 0);

  // Build aging map per client
  const clientMap = new Map<string, ClientAging>();
  for (const inv of invoices) {
    if (!clientMap.has(inv.client_id)) {
      clientMap.set(inv.client_id, {
        client_id: inv.client_id,
        client_name: inv.client_name,
        current: 0, "31-60": 0, "61-90": 0, "90+": 0,
        total: 0,
        invoices: [],
      });
    }
    const bucket = agingBucket(inv.due_date);
    const row = clientMap.get(inv.client_id)!;
    row[bucket] += inv.balance_due_paise;
    row.total += inv.balance_due_paise;
    row.invoices.push(inv);
  }

  const clientAgingRows = Array.from(clientMap.values()).sort((a, b) => b.total - a.total);

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Receivables"
        description="Outstanding invoices and aging buckets across all clients."
      />

      <BillingNav />

      {/* Summary Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Total Outstanding" value={inr(totalOutstanding)} hint={`${invoices.length} invoices`} />
        <KpiTile
          label="Overdue (>30 days)"
          value={inr(overdueTotal)}
          tone="danger"
          hint={`${invoices.filter((i) => i.status === "overdue").length} invoices`}
        />
        <KpiTile label="Due This Week" value={inr(dueThisWeekTotal)} tone="warning" />
        <KpiTile label="Collected This Month" value={inr(collectedThisMonth)} tone="success" />
      </div>

      {/* Aging Report by Client */}
      {clientAgingRows.length > 0 && (
        <div className="mb-5 rounded-2xl border border-border bg-card card-elevated overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">Aging Report — Client Wise</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Client</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Current (0–30)</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">31–60 days</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">61–90 days</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-rose-600 dark:text-rose-400">90+ days</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clientAgingRows.map((row) => (
                  <tr key={row.client_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${row.client_id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {row.client_name}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">
                        {row.invoices.length} invoice{row.invoices.length !== 1 ? "s" : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {row.current > 0 ? inr(row.current) : <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {row["31-60"] > 0 ? inr(row["31-60"]) : <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-orange-600 dark:text-orange-400">
                      {row["61-90"] > 0 ? inr(row["61-90"]) : <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-rose-600 dark:text-rose-400">
                      {row["90+"] > 0 ? inr(row["90+"]) : <span className="text-muted-foreground/60 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      {inr(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40">
                <tr>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">Total</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                    {inr(clientAgingRows.reduce((s, r) => s + r.current, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {inr(clientAgingRows.reduce((s, r) => s + r["31-60"], 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                    {inr(clientAgingRows.reduce((s, r) => s + r["61-90"], 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    {inr(clientAgingRows.reduce((s, r) => s + r["90+"], 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-foreground">
                    {inr(totalOutstanding)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Outstanding Invoice List */}
      <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Outstanding Invoices</h2>
        </div>
        {invoices.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No outstanding invoices. All caught up!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  {[
                    "Invoice #",
                    "Client",
                    "Invoice Date",
                    "Due Date",
                    "Days Past Due",
                    "Total",
                    "Paid",
                    "Balance",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.map((inv) => {
                  const days = inv.due_date ? daysPast(inv.due_date) : null;
                  return (
                    <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/billing/invoices/${inv.id}`}
                          className="font-mono text-sm font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/clients/${inv.client_id}`}
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {inv.client_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {fmt(inv.invoice_date)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {fmt(inv.due_date)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {days !== null && days > 0 ? (
                          <span
                            className={`font-medium ${
                              days > 90
                                ? "text-rose-600 dark:text-rose-400"
                                : days > 60
                                ? "text-orange-600 dark:text-orange-400"
                                : days > 30
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {days}d
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">On time</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                        {inr(inv.total_paise)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-emerald-600 dark:text-emerald-400">
                        {inr(inv.amount_paid_paise)}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-rose-600 dark:text-rose-400">
                        {inr(inv.balance_due_paise)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
  tone?: "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
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
