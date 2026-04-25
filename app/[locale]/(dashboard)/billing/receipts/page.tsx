// Receipts — chronological list of every payment received against any
// invoice, with quick filters by date range and payment mode.
//
// This complements the per-invoice payment history (which lives on the
// invoice detail page) by giving accounts a single place to scan and
// reconcile recent inflows.

import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { Receipt, IndianRupee, Calendar, ArrowRight, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { inr, fmt } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { BillingNav } from "@/components/billing/BillingNav";
import type { PaymentMode, PaymentReceived } from "@/lib/types/database";

export const metadata = { title: "Receipts" };

// Quick-filter presets. "All time" is the unbounded view; everything
// else narrows by payment_date so overdue / long-tail receipts don't
// drown out current-month reconciliation.
const RANGE_OPTIONS: Record<string, { label: string; days: number | null }> = {
  last_7: { label: "Last 7 days", days: 7 },
  last_30: { label: "Last 30 days", days: 30 },
  last_90: { label: "Last 90 days", days: 90 },
  all: { label: "All time", days: null },
};

const PM_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  upi: "UPI",
  online: "Online",
};

type ReceiptRow = PaymentReceived & {
  client?: { id: string; company_name: string } | null;
  invoice?: { id: string; invoice_number: string } | null;
};

export default async function ReceiptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string; mode?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const rangeKey = sp.range && sp.range in RANGE_OPTIONS ? sp.range : "last_30";
  const mode = sp.mode && sp.mode in PM_LABELS ? (sp.mode as PaymentMode) : null;

  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile?.org_id) redirect("/login");

  // Receipt voucher download is finance/accounts/admin/super_admin
  // only — match the API route's gate so we don't show buttons that
  // would 403. Multi-role aware (migration 020).
  const VOUCHER_ROLES = new Set(["super_admin", "admin", "accounts", "finance"]);
  const rolesArr: string[] =
    Array.isArray(session.profile.roles) && session.profile.roles.length > 0
      ? session.profile.roles
      : session.profile.role
        ? [session.profile.role]
        : [];
  const canIssueVoucher = rolesArr.some((r) => VOUCHER_ROLES.has(r));

  const supabase = await createClient();

  // Build query with the selected filters applied server-side so we
  // don't pull thousands of rows just to filter in JS.
  let query = supabase
    .from("payments_received")
    .select(
      "*, client:clients(id, company_name), invoice:invoices(id, invoice_number)"
    )
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const days = RANGE_OPTIONS[rangeKey].days;
  if (days != null) {
    const from = startOfDay(subDays(new Date(), days)).toISOString().slice(0, 10);
    query = query.gte("payment_date", from);
  }
  if (mode) query = query.eq("payment_mode", mode);

  const { data: receiptsData } = await query;
  const receipts = (receiptsData ?? []) as unknown as ReceiptRow[];

  // KPIs based on the *current filter window* so the tile tallies match
  // what the user is actually looking at.
  const totalPaise = receipts.reduce((s, r) => s + (r.amount_paise ?? 0), 0);
  const countByMode = receipts.reduce<Record<string, { count: number; paise: number }>>(
    (acc, r) => {
      const key = r.payment_mode ?? "other";
      if (!acc[key]) acc[key] = { count: 0, paise: 0 };
      acc[key].count += 1;
      acc[key].paise += r.amount_paise ?? 0;
      return acc;
    },
    {}
  );
  const topMode = Object.entries(countByMode).sort((a, b) => b[1].paise - a[1].paise)[0];

  // Build the "today" count without another DB round-trip.
  const todayStr = endOfDay(new Date()).toISOString().slice(0, 10);
  const todayReceipts = receipts.filter((r) => r.payment_date === todayStr.slice(0, 10));
  const todayPaise = todayReceipts.reduce((s, r) => s + (r.amount_paise ?? 0), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Receipts"
        description="Every payment received from clients, grouped chronologically."
      />

      <BillingNav />

      {/* ── Filter bar ── */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {Object.entries(RANGE_OPTIONS).map(([key, opt]) => {
            const active = rangeKey === key;
            // Preserve mode when toggling range.
            const href =
              `/billing/receipts?range=${key}` + (mode ? `&mode=${mode}` : "");
            return (
              <Link
                key={key}
                href={href}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <Link
            href={`/billing/receipts?range=${rangeKey}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !mode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All modes
          </Link>
          {(Object.keys(PM_LABELS) as PaymentMode[]).map((m) => {
            const active = mode === m;
            return (
              <Link
                key={m}
                href={`/billing/receipts?range=${rangeKey}&mode=${m}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {PM_LABELS[m]}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          icon={<IndianRupee className="h-4 w-4 text-emerald-600" />}
          label="Total received"
          value={inr(totalPaise)}
          hint={`${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`}
        />
        <Tile
          icon={<Calendar className="h-4 w-4 text-indigo-600" />}
          label="Today"
          value={inr(todayPaise)}
          hint={`${todayReceipts.length} receipt${todayReceipts.length === 1 ? "" : "s"}`}
        />
        <Tile
          icon={<Receipt className="h-4 w-4 text-violet-600" />}
          label="Top payment mode"
          value={topMode ? PM_LABELS[topMode[0] as PaymentMode] ?? topMode[0] : "—"}
          hint={topMode ? inr(topMode[1].paise) : "No receipts yet"}
        />
        <Tile
          icon={<ArrowRight className="h-4 w-4 text-amber-600" />}
          label="Avg receipt"
          value={inr(receipts.length ? Math.round(totalPaise / receipts.length) : 0)}
          hint="Across this window"
        />
      </div>

      {/* ── Receipts table ── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
          </h2>
          <p className="text-xs text-muted-foreground">Showing latest 200</p>
        </div>

        {receipts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Receipt className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">
              No receipts for this filter.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Record payments from any invoice detail page.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Receipt #</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Client</th>
                    <th className="px-4 py-3 text-left">Invoice</th>
                    <th className="px-4 py-3 text-left">Mode</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    {canIssueVoucher && <th className="px-4 py-3 text-right">Voucher</th>}
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {r.receipt_number ?? "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {fmt(r.payment_date)}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {r.client ? (
                          <Link href={`/clients/${r.client.id}`} className="hover:text-primary hover:underline">
                            {r.client.company_name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.invoice ? (
                          <Link
                            href={`/billing/invoices/${r.invoice.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {r.invoice.invoice_number}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {PM_LABELS[r.payment_mode] ?? r.payment_mode}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.reference_number ?? "—"}
                        {r.bank_name && (
                          <span className="ml-1 text-xs text-muted-foreground">· {r.bank_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                        {inr(r.amount_paise)}
                      </td>
                      {canIssueVoucher && (
                        <td className="px-4 py-3 text-right">
                          <a
                            href={`/api/pdf/receipt-voucher/${r.id}`}
                            download
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted"
                            title="Download receipt voucher"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Voucher
                          </a>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
