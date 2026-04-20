"use client";

// ClientRevenueExport — downloads client revenue summary as CSV.
// Receives pre-aggregated data from the server component.

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/utils";

// ─── Shared type ─────────────────────────────────────────────────────────────

export interface ClientRevenueRow {
  client_id: string;
  company_name: string;
  brand_name: string | null;
  total_invoices: number;
  total_billed_paise: number;
  total_received_paise: number;
  total_outstanding_paise: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  data: ClientRevenueRow[];
}

export function ClientRevenueExport({ data }: Props) {
  function handleDownload() {
    const headers = [
      "Company Name",
      "Brand Name",
      "Total Invoices",
      "Total Billed (INR)",
      "Total Received (INR)",
      "Outstanding (INR)",
    ];

    const rows = data.map((row) => [
      csvCell(row.company_name),
      csvCell(row.brand_name ?? ""),
      csvCell(row.total_invoices),
      csvCell(inr(row.total_billed_paise)),
      csvCell(inr(row.total_received_paise)),
      csvCell(inr(row.total_outstanding_paise)),
    ]);

    const csvContent = [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `client-revenue-${new Date().toISOString().slice(0, 10)}.csv`;
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
