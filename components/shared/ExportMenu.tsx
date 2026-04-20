"use client";
// ExportMenu — Dropdown button for exporting data as Excel (.xlsx) or CSV.
// Sits in the PageHeader `actions` slot on list pages.
import { useState, useRef, useEffect, useCallback } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ExportColumn {
  header: string;
  // Key path into the row object (e.g. "site_code", "city")
  key: string;
  // Optional transform applied before writing to the cell
  format?: (value: unknown, row: Record<string, unknown>) => string | number;
}

interface ExportMenuProps {
  data: Record<string, unknown>[];
  columns: ExportColumn[];
  filenameBase: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function cellValue(col: ExportColumn, row: Record<string, unknown>): string | number {
  const raw = row[col.key];
  if (col.format) return col.format(raw, row);
  if (raw === null || raw === undefined) return "";
  return String(raw);
}

export function ExportMenu({ data, columns, filenameBase }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const exportCSV = useCallback(() => {
    const header = columns.map((c) => c.header).join(",");
    const rows = data.map((row) =>
      columns.map((col) => {
        const v = cellValue(col, row);
        // Escape commas / quotes for CSV
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), `${filenameBase}.csv`);
    setOpen(false);
  }, [data, columns, filenameBase]);

  const exportExcel = useCallback(async () => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const aoaData = [
        columns.map((c) => c.header),
        ...data.map((row) => columns.map((col) => cellValue(col, row))),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoaData);
      // Auto-size columns
      ws["!cols"] = columns.map((col, i) => {
        const maxLen = Math.max(
          col.header.length,
          ...data.map((row) => String(cellValue(col, row)).length)
        );
        return { wch: Math.min(maxLen + 2, 50) };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      downloadBlob(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${filenameBase}.xlsx`
      );
    } catch (err) {
      console.error("Excel export failed:", err);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }, [data, columns, filenameBase]);

  if (data.length === 0) return null;

  return (
    <div ref={menuRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Export
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <button
            type="button"
            onClick={exportExcel}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={exportCSV}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <FileText className="h-4 w-4 text-blue-600" />
            CSV (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
