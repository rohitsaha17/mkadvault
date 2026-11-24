// Invoices list — themed to match the app-wide UI overhaul.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  ISSUED_INVOICE_STATUSES,
  OPEN_INVOICE_STATUSES,
  invoiceState,
  summariseReceivables,
} from "@/lib/receivables";
import { inr, fmt } from "@/lib/utils";
import { monthEnd, todayInIndia } from "@/lib/utils/time-buckets";
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
  agency?: { id: string; agency_name: string } | null;
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

  const today = todayInIndia();

  const [
    { data: openInvoices, error: openError },
    { data: thisMonthData, error: monthError },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("balance_due_paise, due_date, status")
      .in("status", OPEN_INVOICE_STATUSES)
      .is("deleted_at", null),
    // Revenue is the taxable value of invoices issued, as on the dashboard.
    supabase
      .from("invoices")
      .select("subtotal_paise")
      .in("status", ISSUED_INVOICE_STATUSES)
      .gte("invoice_date", `${today.slice(0, 7)}-01`)
      // Not "-31": in a 30-day month that isn't a date and the query fails.
      .lte("invoice_date", monthEnd(today))
      .is("deleted_at", null),
  ]);

  // null = couldn't be read. Shown as "—", never as ₹0.
  const summary = openError
    ? null
    : summariseReceivables(openInvoices ?? [], today);
  const monthRevenue = monthError
    ? null
    : (thisMonthData ?? []).reduce((s, i) => s + (i.subtotal_paise ?? 0), 0);
  const monthCount = thisMonthData?.length ?? 0;

  // Fetch invoices + direct-client join first. The agency side (migration
  // 047) is hydrated in a second query so the list keeps working even
  // when 047 hasn't been applied yet — otherwise the embedded join
  // would error and the page would silently render as empty.
  let query = supabase
    .from("invoices")
    .select("*, client:clients(id, company_name)", { count: "exact" })
    .is("deleted_at", null)
    .order(sortCol, { ascending: sortDir === "asc" });

  // "Sent" and "Overdue" split on the due date. See lib/receivables.ts.
  if (tab === "overdue") {
    query = query
      .in("status", OPEN_INVOICE_STATUSES)
      .lt("due_date", today)
      .gt("balance_due_paise", 0);
  } else if (tab === "sent") {
    query = query.eq("status", "sent").gte("due_date", today);
  } else if (tab !== "all") {
    query = query.eq("status", tab as InvoiceStatus);
  }
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, count } = await query;
  const invoices = (data ?? []) as unknown as InvoiceWithClient[];

  // Hydrate agency names for agency-billed invoices. When the column
  // doesn't exist (pre-047) the map stays empty and all rows render
  // as direct-client invoices.
  const agencyIds = Array.from(
    new Set(
      invoices
        .map((i) => (i as { billed_agency_id?: string | null }).billed_agency_id)
        .filter((id): id is string => !!id),
    ),
  );
  if (agencyIds.length > 0) {
    const { data: agencyRows } = await supabase
      .from("partner_agencies")
      .select("id, agency_name")
      .in("id", agencyIds);
    const agencyMap = new Map((agencyRows ?? []).map((a) => [a.id, a]));
    for (const inv of invoices) {
      const agencyId = (inv as { billed_agency_id?: string | null }).billed_agency_id;
      if (agencyId && agencyMap.has(agencyId)) {
        inv.agency = agencyMap.get(agencyId)!;
      }
    }
  }
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
        <KpiTile
          label="Total Outstanding"
          value={inr(summary?.outstanding)}
          hint={summary ? `${openInvoices?.length ?? 0} invoices` : "Couldn't load"}
        />
        <KpiTile
          label="Overdue Amount"
          value={inr(summary?.overdue)}
          hint={summary ? `${summary.overdueCount} past their due date` : "Couldn't load"}
          tone={summary?.overdue ? "danger" : undefined}
        />
        <KpiTile
          label="This Month's Revenue"
          value={inr(monthRevenue)}
          hint={monthRevenue === null ? "Couldn't load" : `Before GST, ${monthCount} ${monthCount === 1 ? "invoice" : "invoices"}`}
          tone="success"
        />
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
                  <TableHead>Bill to</TableHead>
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
                      {inv.bill_to_type === "agency" && inv.agency ? (
                        <Link
                          href={`/agencies/${inv.agency.id}`}
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {inv.agency.agency_name}
                          <span className="ml-1.5 inline-flex items-center rounded border border-border bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                            Agency
                          </span>
                        </Link>
                      ) : inv.client ? (
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
                      <StatusBadge status={invoiceState(inv, today)} />
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
