// Invoices list — themed to match the app-wide UI overhaul.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inr, fmt } from "@/lib/utils";
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
import { SortableTableHead } from "@/components/shared/SortableTableHead";
import { Plus, Receipt } from "lucide-react";
import { BillingNav } from "@/components/billing/BillingNav";
import { ListExportMenu } from "@/components/shared/ListExportMenu";
import type { Invoice, Client, InvoiceStatus } from "@/lib/types/database";

export const metadata = { title: "Invoices" };

const TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
];

interface InvoiceWithClient extends Invoice {
  client?: Pick<Client, "id" | "company_name"> | null;
}

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("billing");

  const { tab = "all", page, sort, dir } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));

  // Validate sort column against allowlist to prevent arbitrary column access
  const SORTABLE_COLUMNS = ["invoice_number", "invoice_date", "due_date", "total_paise", "status"] as const;
  const sortCol = SORTABLE_COLUMNS.includes(sort as typeof SORTABLE_COLUMNS[number])
    ? (sort as typeof SORTABLE_COLUMNS[number])
    : "invoice_date";
  const sortDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";
  const PAGE_SIZE = 25;
  const offset = (currentPage - 1) * PAGE_SIZE;

  const supabase = await createClient();

  const thisMonth = new Date().toISOString().slice(0, 7);

  const [{ data: allInvoices }, { data: thisMonthData }] = await Promise.all([
    supabase
      .from("invoices")
      .select("total_paise, amount_paid_paise, balance_due_paise, status")
      .is("deleted_at", null),
    supabase
      .from("invoices")
      .select("total_paise")
      .gte("invoice_date", `${thisMonth}-01`)
      .lte("invoice_date", `${thisMonth}-31`)
      .eq("status", "paid")
      .is("deleted_at", null),
  ]);

  const outstanding = (allInvoices ?? []).reduce(
    (s, i) =>
      s +
      (["sent", "partially_paid", "overdue"].includes(i.status)
        ? i.balance_due_paise ?? 0
        : 0),
    0
  );
  const overdueTotal = (allInvoices ?? []).reduce(
    (s, i) => s + (i.status === "overdue" ? i.balance_due_paise ?? 0 : 0),
    0
  );
  const monthRevenue = (thisMonthData ?? []).reduce(
    (s, i) => s + (i.total_paise ?? 0),
    0
  );

  let query = supabase
    .from("invoices")
    .select("*, client:clients(id, company_name)", { count: "exact" })
    .is("deleted_at", null)
    .order(sortCol, { ascending: sortDir === "asc" });

  if (tab !== "all") query = query.eq("status", tab as InvoiceStatus);
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, count } = await query;
  const invoices = (data ?? []) as unknown as InvoiceWithClient[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ListExportMenu entityType="invoices" data={invoices as unknown as Record<string, unknown>[]} filenameBase="invoices" />
            <Link href="/billing/invoices/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create Invoice
              </Button>
            </Link>
          </>
        }
      />

      <BillingNav />

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="Total Outstanding" value={inr(outstanding)} />
        <KpiTile label="Overdue Amount" value={inr(overdueTotal)} tone="danger" />
        <KpiTile label="This Month's Revenue" value={inr(monthRevenue)} tone="success" />
      </div>

      {/* Status tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((tabItem) => (
          <Link
            key={tabItem.key}
            href={`/billing/invoices?tab=${tabItem.key}&sort=${sortCol}&dir=${sortDir}`}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === tabItem.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tabItem.label}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Receipt className="h-7 w-7" />}
          title={t("invoices.noInvoices")}
          description={t("invoices.noInvoicesDesc")}
          action={
            <Link href="/billing/invoices/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create Invoice
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="invoice_number" label="Invoice #" currentSort={sortCol} currentDir={sortDir} />
                  <SortableTableHead column="invoice_date" label="Date" currentSort={sortCol} currentDir={sortDir} />
                  <TableHead>Client</TableHead>
                  <SortableTableHead column="total_paise" label="Total" currentSort={sortCol} currentDir={sortDir} />
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <SortableTableHead column="due_date" label="Due Date" currentSort={sortCol} currentDir={sortDir} />
                  <SortableTableHead column="status" label="Status" currentSort={sortCol} currentDir={sortDir} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link
                        href={`/billing/invoices/${inv.id}`}
                        className="font-mono text-sm font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {inv.invoice_number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmt(inv.invoice_date)}
                    </TableCell>
                    <TableCell>
                      {inv.client ? (
                        <Link
                          href={`/clients/${inv.client.id}`}
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {inv.client.company_name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground tabular-nums">
                      {inr(inv.total_paise)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {inr(inv.amount_paid_paise)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        (inv.balance_due_paise ?? 0) > 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {inr(inv.balance_due_paise)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmt(inv.due_date)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {currentPage > 1 && (
                <Link href={`/billing/invoices?tab=${tab}&sort=${sortCol}&dir=${sortDir}&page=${currentPage - 1}`}>
                  <Button variant="outline" size="sm">← Previous</Button>
                </Link>
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link href={`/billing/invoices?tab=${tab}&sort=${sortCol}&dir=${sortDir}&page=${currentPage + 1}`}>
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
  tone,
}: {
  label: string;
  value: string;
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
    </div>
  );
}
