// Client Revenue Report — billed, received, and outstanding amounts per client.
//
// We fetch all invoices (with client join) then aggregate in TypeScript.
// amount_paid_paise on the invoice row is kept in sync whenever a payment
// is recorded, so we can trust it without joining payments_received.

import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { inr } from "@/lib/utils";
import {
  ClientRevenueExport,
  type ClientRevenueRow,
} from "@/components/reports/ClientRevenueExport";

// ─── Supabase join type ───────────────────────────────────────────────────────

interface InvoiceWithClient {
  client_id: string;
  total_paise: number;
  amount_paid_paise: number;
  balance_due_paise: number;
  status: string;
  invoice_date: string;
  client: {
    company_name: string;
    brand_name: string | null;
  } | null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ClientRevenuePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);

  const { profile } = session;

  if (!profile?.org_id) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        Your account is not linked to an organisation yet.
      </div>
    );
  }

  const orgId: string = profile.org_id;

  // Fetch invoices with embedded client name
  const { data: invoicesData, error } = await supabase
    .from("invoices")
    .select(
      "client_id, total_paise, amount_paid_paise, balance_due_paise, status, invoice_date, client:clients(company_name, brand_name)"
    )
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  if (error) {
    return (
      <div className="p-6 text-red-500 text-sm">
        Failed to load invoices: {error.message}
      </div>
    );
  }

  const invoices = (invoicesData ?? []) as unknown as InvoiceWithClient[];

  // ── Aggregate by client ───────────────────────────────────────────────────

  // Map from client_id → accumulator
  const map = new Map<
    string,
    {
      company_name: string;
      brand_name: string | null;
      total_invoices: number;
      total_billed_paise: number;
      total_received_paise: number;
      total_outstanding_paise: number;
    }
  >();

  for (const inv of invoices) {
    if (!inv.client_id) continue;

    const existing = map.get(inv.client_id);
    if (existing) {
      existing.total_invoices += 1;
      existing.total_billed_paise += inv.total_paise ?? 0;
      existing.total_received_paise += inv.amount_paid_paise ?? 0;
      existing.total_outstanding_paise += inv.balance_due_paise ?? 0;
    } else {
      map.set(inv.client_id, {
        company_name: inv.client?.company_name ?? "Unknown Client",
        brand_name: inv.client?.brand_name ?? null,
        total_invoices: 1,
        total_billed_paise: inv.total_paise ?? 0,
        total_received_paise: inv.amount_paid_paise ?? 0,
        total_outstanding_paise: inv.balance_due_paise ?? 0,
      });
    }
  }

  // Convert to array, sorted by total billed descending
  const rows: ClientRevenueRow[] = Array.from(map.entries())
    .map(([client_id, agg]) => ({ client_id, ...agg }))
    .sort((a, b) => b.total_billed_paise - a.total_billed_paise);

  // Summary totals
  const totalBilled = rows.reduce((s, r) => s + r.total_billed_paise, 0);
  const totalReceived = rows.reduce((s, r) => s + r.total_received_paise, 0);
  const totalOutstanding = rows.reduce((s, r) => s + r.total_outstanding_paise, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Client Revenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Billing and collection summary across {rows.length} client
            {rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <ClientRevenueExport data={rows} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Total Billed" value={inr(totalBilled)} />
        <SummaryCard label="Total Received" value={inr(totalReceived)} highlight="green" />
        <SummaryCard
          label="Outstanding"
          value={inr(totalOutstanding)}
          highlight={totalOutstanding > 0 ? "amber" : undefined}
        />
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">No invoice data found.</p>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Total Billed</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.client_id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{row.company_name}</div>
                    {row.brand_name && (
                      <div className="text-xs text-muted-foreground">{row.brand_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.total_invoices}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground font-medium">
                    {inr(row.total_billed_paise)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">
                    {inr(row.total_received_paise)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${
                      row.total_outstanding_paise > 0 ? "text-amber-600" : "text-muted-foreground"
                    }`}
                  >
                    {inr(row.total_outstanding_paise)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/${locale}/clients/${row.client_id}`}>
                      <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {/* Totals row */}
            <TableFooter>
              <TableRow className="bg-muted font-semibold">
                <TableCell className="text-foreground">Total</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums text-foreground">
                  {inr(totalBilled)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">
                  {inr(totalReceived)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    totalOutstanding > 0 ? "text-amber-700" : "text-muted-foreground"
                  }`}
                >
                  {inr(totalOutstanding)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "green" | "amber";
}) {
  const valueClass =
    highlight === "green"
      ? "text-emerald-600"
      : highlight === "amber"
      ? "text-amber-600"
      : "text-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
