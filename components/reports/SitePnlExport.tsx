"use client";

// SitePnlExport — client component that turns the Site P&L data into a
// downloadable CSV file when the user clicks the button.
// It never calls the server — the data is passed in as props from the
// server component so the download happens entirely in the browser.

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/utils";

// ─── Shared type ─────────────────────────────────────────────────────────────
// Exported so the server page can import it for its TypeScript typing too.

export interface SitePnlRow {
  id: string;
  name: string;
  site_code: string;
  city: string;
  status: string;
  total_sqft: number | null;
  revenue_paise: number;
  costs_paise: number;
  profit_paise: number;
  margin_pct: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Wrap a CSV cell in quotes and escape any quotes inside the value.
function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  data: SitePnlRow[];
}

export function SitePnlExport({ data }: Props) {
  function handleDownload() {
    // Build header row
    const headers = [
      "Site Code",
      "Site Name",
      "City",
      "Status",
      "Total Sqft",
      "Revenue (INR)",
      "Costs (INR)",
      "Net Profit (INR)",
      "Margin %",
    ];

    // Build data rows
    const rows = data.map((row) => [
      csvCell(row.site_code),
      csvCell(row.name),
      csvCell(row.city),
      csvCell(row.status),
      csvCell(row.total_sqft),
      csvCell(inr(row.revenue_paise)),
      csvCell(inr(row.costs_paise)),
      csvCell(inr(row.profit_paise)),
      csvCell(row.margin_pct.toFixed(1) + "%"),
    ]);

    const csvContent = [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");

    // Create a Blob and trigger a download via a temporary <a> element
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `site-pnl-${new Date().toISOString().slice(0, 10)}.csv`;
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
