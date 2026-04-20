"use client";

// SiteInventoryExport — downloads the full site inventory table as a CSV.
// Data is passed in from the server component; no API call is made here.

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/utils";

// ─── Shared type ─────────────────────────────────────────────────────────────

export interface SiteInventoryRow {
  id: string;
  site_code: string;
  name: string;
  city: string;
  state: string;
  media_type: string;
  width_ft: number | null;
  height_ft: number | null;
  total_sqft: number | null;
  status: string;
  ownership_model: string;
  base_rate_paise: number | null;
  illumination: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  data: SiteInventoryRow[];
}

export function SiteInventoryExport({ data }: Props) {
  function handleDownload() {
    const headers = [
      "Site Code",
      "Name",
      "City",
      "State",
      "Media Type",
      "Width (ft)",
      "Height (ft)",
      "Total Sqft",
      "Status",
      "Ownership",
      "Base Rate (INR/month)",
      "Illumination",
    ];

    const rows = data.map((row) => [
      csvCell(row.site_code),
      csvCell(row.name),
      csvCell(row.city),
      csvCell(row.state),
      csvCell(row.media_type),
      csvCell(row.width_ft),
      csvCell(row.height_ft),
      csvCell(row.total_sqft),
      csvCell(row.status),
      csvCell(row.ownership_model),
      csvCell(row.base_rate_paise != null ? inr(row.base_rate_paise) : ""),
      csvCell(row.illumination ?? ""),
    ]);

    const csvContent = [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `site-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
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
