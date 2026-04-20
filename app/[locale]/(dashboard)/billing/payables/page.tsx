// Payables list — themed to match the app-wide UI overhaul.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inr, fmt } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BillingNav } from "@/components/billing/BillingNav";
import { Wallet } from "lucide-react";

export const metadata = { title: "Payables" };

const PM_LABELS: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  upi: "UPI",
  online: "Online",
};

interface PaymentRow {
  id: string;
  due_date: string;
  amount_due_paise: number;
  amount_paid_paise: number | null;
  tds_deducted_paise: number | null;
  payment_date: string | null;
  payment_mode: string | null;
  payment_reference: string | null;
  status: string;
  notes: string | null;
  contract_id: string;
  contract_type: string;
  counterparty_name: string;
  site_name: string | null;
}

export default async function PayablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { tab = "upcoming", page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const PAGE_SIZE = 25;
  const offset = (currentPage - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const nextThirtyDate = new Date();
  nextThirtyDate.setDate(nextThirtyDate.getDate() + 30);
  const nextThirtyDays = nextThirtyDate.toISOString().slice(0, 10);

  const [
    { data: upcomingData },
    { data: overdueData },
    { data: paidThisMonthData },
  ] = await Promise.all([
    supabase
      .from("contract_payments")
      .select("amount_due_paise, tds_deducted_paise")
      .in("status", ["upcoming", "due"])
      .lte("due_date", nextThirtyDays),
    supabase
      .from("contract_payments")
      .select("amount_due_paise, amount_paid_paise, tds_deducted_paise")
      .eq("status", "overdue"),
    supabase
      .from("contract_payments")
      .select("amount_paid_paise")
      .eq("status", "paid")
      .gte("payment_date", `${thisMonth}-01`)
      .lte("payment_date", `${thisMonth}-31`),
  ]);

  const upcomingTotal = (upcomingData ?? []).reduce((s, p) => {
    const net = (p.amount_due_paise ?? 0) - (p.tds_deducted_paise ?? 0);
    return s + net;
  }, 0);
  const overdueTotal = (overdueData ?? []).reduce((s, p) => {
    const net =
      (p.amount_due_paise ?? 0) -
      (p.amount_paid_paise ?? 0) -
      (p.tds_deducted_paise ?? 0);
    return s + Math.max(0, net);
  }, 0);
  const paidThisMonth = (paidThisMonthData ?? []).reduce(
    (s, p) => s + (p.amount_paid_paise ?? 0),
    0
  );

  let statusFilter: string[];
  if (tab === "overdue") statusFilter = ["overdue"];
  else if (tab === "paid") statusFilter = ["paid"];
  else statusFilter = ["upcoming", "due"];

  const { data: paymentsData, count } = await supabase
    .from("contract_payments")
    .select(
      `
      id, due_date, amount_due_paise, amount_paid_paise,
      tds_deducted_paise, tds_percentage,
      payment_date, payment_mode, payment_reference,
      status, notes,
      contract:contracts(
        id, contract_type,
        site:sites(name),
        landowner:landowners(full_name),
        agency:partner_agencies(agency_name)
      )
    `,
      { count: "exact" }
    )
    .in("status", statusFilter)
    .order("due_date", { ascending: tab !== "paid" })
    .range(offset, offset + PAGE_SIZE - 1);

  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const payments: PaymentRow[] = (paymentsData ?? []).map((p) => {
    const contract = p.contract as unknown as {
      id: string;
      contract_type: string;
      site?: { name: string } | null;
      landowner?: { full_name: string } | null;
      agency?: { agency_name: string } | null;
    } | null;

    const counterparty =
      contract?.contract_type === "landowner"
        ? contract.landowner?.full_name ?? "Unknown Landowner"
        : contract?.agency?.agency_name ?? "Unknown Agency";

    return {
      id: p.id,
      due_date: p.due_date,
      amount_due_paise: p.amount_due_paise ?? 0,
      amount_paid_paise: p.amount_paid_paise ?? null,
      tds_deducted_paise: p.tds_deducted_paise ?? null,
      payment_date: p.payment_date,
      payment_mode: p.payment_mode,
      payment_reference: p.payment_reference,
      status: p.status,
      notes: p.notes,
      contract_id: contract?.id ?? "",
      contract_type: contract?.contract_type ?? "landowner",
      counterparty_name: counterparty,
      site_name: contract?.site?.name ?? null,
    };
  });

  const TABS = [
    { key: "upcoming", label: "Upcoming (30 days)" },
    { key: "overdue", label: "Overdue" },
    { key: "paid", label: "Paid" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Payables"
        description="Payments owed to landowners and partner agencies."
      />

      <BillingNav />

      {/* Summary Cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="Due Next 30 Days" value={inr(upcomingTotal)} hint="Net of TDS" />
        <KpiTile label="Overdue Payables" value={inr(overdueTotal)} tone="danger" />
        <KpiTile label="Paid This Month" value={inr(paidThisMonth)} tone="success" />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/billing/payables?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {payments.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Wallet className="h-7 w-7" />}
          title={`No ${tab} payables`}
          description="You're all caught up."
        />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount Due</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                  <TableHead className="text-right">Net Payable</TableHead>
                  <TableHead>Status</TableHead>
                  {tab === "paid" && <TableHead>Paid On</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => {
                  const net = p.amount_due_paise - (p.tds_deducted_paise ?? 0);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium text-foreground">{p.counterparty_name}</p>
                        {p.notes && (
                          <p className="max-w-[200px] truncate text-[11px] text-muted-foreground">
                            {p.notes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {p.contract_type === "landowner" ? "Landowner" : "Agency"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.site_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {fmt(p.due_date)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground tabular-nums">
                        {inr(p.amount_due_paise)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {p.tds_deducted_paise ? inr(p.tds_deducted_paise) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground tabular-nums">
                        {inr(net)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      {tab === "paid" && (
                        <TableCell className="text-xs text-muted-foreground">
                          {fmt(p.payment_date)}
                          {p.payment_mode && (
                            <span className="ml-1">
                              · {PM_LABELS[p.payment_mode] ?? p.payment_mode}
                            </span>
                          )}
                          {p.payment_reference && <p>{p.payment_reference}</p>}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {currentPage > 1 && (
                <Link href={`/billing/payables?tab=${tab}&page=${currentPage - 1}`}>
                  <Button variant="outline" size="sm">← Previous</Button>
                </Link>
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link href={`/billing/payables?tab=${tab}&page=${currentPage + 1}`}>
                  <Button variant="outline" size="sm">Next →</Button>
                </Link>
              )}
            </div>
          )}
        </>
      )}
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
