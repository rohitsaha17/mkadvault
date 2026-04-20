// GST Summary Report — monthly CGST / SGST / IGST breakdown.
//
// Fetches all invoices ordered by invoice_date, then groups by calendar month
// in TypeScript (no SQL GROUP BY required for this scale).
// The totals row at the bottom helps the accountant verify against GST portal.

import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
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
  GstSummaryExport,
  type GstMonthRow,
} from "@/components/reports/GstSummaryExport";

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function GstSummaryPage({
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

  // Fetch all non-deleted invoices (exclude cancelled ones from tax liability)
  const { data: invoicesData, error } = await supabase
    .from("invoices")
    .select(
      "invoice_date, subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise, is_inter_state"
    )
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .neq("status", "draft")
    .order("invoice_date");

  if (error) {
    return (
      <div className="p-6 text-red-500 text-sm">
        Failed to load invoices: {error.message}
      </div>
    );
  }

  const invoices = invoicesData ?? [];

  // ── Group by month ────────────────────────────────────────────────────────

  // month_key is "YYYY-MM" — used for sorting and deduplication
  const monthMap = new Map<
    string,
    {
      month_label: string;
      taxable_paise: number;
      cgst_paise: number;
      sgst_paise: number;
      igst_paise: number;
      total_tax_paise: number;
      total_invoice_paise: number;
    }
  >();

  for (const inv of invoices) {
    if (!inv.invoice_date) continue;

    // Parse the date and derive the month key
    let parsed: Date;
    try {
      parsed = parseISO(inv.invoice_date as string);
    } catch {
      continue; // skip malformed dates
    }

    const monthKey = format(parsed, "yyyy-MM");
    const monthLabel = format(parsed, "MMM yyyy");

    const taxable = (inv.subtotal_paise as number) ?? 0;
    const cgst = (inv.cgst_paise as number) ?? 0;
    const sgst = (inv.sgst_paise as number) ?? 0;
    const igst = (inv.igst_paise as number) ?? 0;
    const total = (inv.total_paise as number) ?? 0;
    const totalTax = cgst + sgst + igst;

    const existing = monthMap.get(monthKey);
    if (existing) {
      existing.taxable_paise += taxable;
      existing.cgst_paise += cgst;
      existing.sgst_paise += sgst;
      existing.igst_paise += igst;
      existing.total_tax_paise += totalTax;
      existing.total_invoice_paise += total;
    } else {
      monthMap.set(monthKey, {
        month_label: monthLabel,
        taxable_paise: taxable,
        cgst_paise: cgst,
        sgst_paise: sgst,
        igst_paise: igst,
        total_tax_paise: totalTax,
        total_invoice_paise: total,
      });
    }
  }

  // Convert to sorted array (already insertion-order sorted from the ordered query)
  const rows: GstMonthRow[] = Array.from(monthMap.entries()).map(
    ([month_key, agg]) => ({ month_key, ...agg })
  );

  // Grand totals
  const grandTotals = rows.reduce(
    (acc, r) => ({
      taxable_paise: acc.taxable_paise + r.taxable_paise,
      cgst_paise: acc.cgst_paise + r.cgst_paise,
      sgst_paise: acc.sgst_paise + r.sgst_paise,
      igst_paise: acc.igst_paise + r.igst_paise,
      total_tax_paise: acc.total_tax_paise + r.total_tax_paise,
      total_invoice_paise: acc.total_invoice_paise + r.total_invoice_paise,
    }),
    {
      taxable_paise: 0,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      total_tax_paise: 0,
      total_invoice_paise: 0,
    }
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">GST Summary</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monthly tax breakdown — excludes draft and cancelled invoices
          </p>
        </div>
        <GstSummaryExport data={rows} />
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Taxable Value" value={inr(grandTotals.taxable_paise)} />
        <SummaryCard label="CGST" value={inr(grandTotals.cgst_paise)} />
        <SummaryCard label="SGST" value={inr(grandTotals.sgst_paise)} />
        <SummaryCard label="IGST" value={inr(grandTotals.igst_paise)} />
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">
          No invoice data to display.
        </p>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Taxable Value</TableHead>
                <TableHead className="text-right">CGST (9%)</TableHead>
                <TableHead className="text-right">SGST (9%)</TableHead>
                <TableHead className="text-right">IGST (18%)</TableHead>
                <TableHead className="text-right">Total Tax</TableHead>
                <TableHead className="text-right">Invoice Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.month_key}>
                  <TableCell className="font-medium text-foreground">
                    {row.month_label}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {inr(row.taxable_paise)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {inr(row.cgst_paise)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {inr(row.sgst_paise)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {inr(row.igst_paise)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-foreground">
                    {inr(row.total_tax_paise)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">
                    {inr(row.total_invoice_paise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {/* Grand totals row */}
            <TableFooter>
              <TableRow className="bg-muted font-semibold text-foreground">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {inr(grandTotals.taxable_paise)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {inr(grandTotals.cgst_paise)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {inr(grandTotals.sgst_paise)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {inr(grandTotals.igst_paise)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-blue-700">
                  {inr(grandTotals.total_tax_paise)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-blue-700">
                  {inr(grandTotals.total_invoice_paise)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
