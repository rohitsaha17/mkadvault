"use client";

// GstSummaryExport — downloads the GST monthly summary as CSV.

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/utils";

// ─── Shared type ─────────────────────────────────────────────────────────────

export interface GstMonthRow {
  month_key: string; // "2026-04" — used for sorting
  month_label: string; // "Apr 2026" — used for display
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_tax_paise: number;
  total_invoice_paise: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  data: GstMonthRow[];
}

export function GstSummaryExport({ data }: Props) {
  function handleDownload() {
    const headers = [
      "Month",
      "Taxable Value (INR)",
      "CGST (INR)",
      "SGST (INR)",
      "IGST (INR)",
      "Total Tax (INR)",
      "Total Invoice Value (INR)",
    ];

    const rows = data.map((row) => [
      csvCell(row.month_label),
      csvCell(inr(row.taxable_paise)),
      csvCell(inr(row.cgst_paise)),
      csvCell(inr(row.sgst_paise)),
      csvCell(inr(row.igst_paise)),
      csvCell(inr(row.total_tax_paise)),
      csvCell(inr(row.total_invoice_paise)),
    ]);

    const csvContent = [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gst-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <Download className="h-4 w-4 mr-2" />
      Export CSV
    </Button>
  );
}
