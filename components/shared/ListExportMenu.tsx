"use client";
// Thin wrapper around ExportMenu that defines export columns per entity type.
// Used in server-component list pages that can't pass format functions directly.
import { ExportMenu, type ExportColumn } from "./ExportMenu";
import { inr as inrBase } from "@/lib/utils";

// Wrapper to match ExportColumn format signature (value: unknown) => string | number
function inr(value: unknown): string {
  return inrBase(typeof value === "number" ? value : null);
}

function fmtDate(val: unknown): string {
  if (!val) return "";
  const d = new Date(String(val));
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function humanize(val: unknown): string {
  if (!val) return "";
  return String(val).replace(/_/g, " ");
}

const COLUMNS: Record<string, ExportColumn[]> = {
  sites: [
    { header: "Site Code", key: "site_code" },
    { header: "Name", key: "name" },
    { header: "Media Type", key: "media_type", format: humanize },
    { header: "Status", key: "status", format: humanize },
    { header: "City", key: "city" },
    { header: "State", key: "state" },
    { header: "Ownership", key: "ownership_model", format: humanize },
    { header: "Width (ft)", key: "width_ft" },
    { header: "Height (ft)", key: "height_ft" },
    { header: "Sq Ft", key: "total_sqft" },
    { header: "Rate / Month", key: "base_rate_paise", format: inr },
  ],
  clients: [
    { header: "Company", key: "company_name" },
    { header: "Brand", key: "brand_name" },
    { header: "Industry", key: "industry_category" },
    { header: "Type", key: "client_type", format: humanize },
    { header: "Credit Terms", key: "credit_terms", format: humanize },
    { header: "Contact Name", key: "primary_contact_name" },
    { header: "Phone", key: "primary_contact_phone" },
    { header: "Email", key: "primary_contact_email" },
    { header: "GSTIN", key: "gstin" },
    { header: "City", key: "city" },
    { header: "State", key: "state" },
  ],
  campaigns: [
    { header: "Campaign", key: "campaign_name" },
    { header: "Code", key: "campaign_code" },
    { header: "Client", key: "client", format: (v) => {
      if (v && typeof v === "object" && "company_name" in (v as Record<string, unknown>))
        return String((v as Record<string, unknown>).company_name ?? "");
      return "";
    }},
    { header: "Start Date", key: "start_date", format: fmtDate },
    { header: "End Date", key: "end_date", format: fmtDate },
    { header: "Status", key: "status", format: humanize },
    { header: "Total Value", key: "total_value_paise", format: inr },
  ],
  invoices: [
    { header: "Invoice #", key: "invoice_number" },
    { header: "Date", key: "invoice_date", format: fmtDate },
    { header: "Client", key: "client", format: (v) => {
      if (v && typeof v === "object" && "company_name" in (v as Record<string, unknown>))
        return String((v as Record<string, unknown>).company_name ?? "");
      return "";
    }},
    { header: "Total", key: "total_paise", format: inr },
    { header: "Paid", key: "amount_paid_paise", format: inr },
    { header: "Balance Due", key: "balance_due_paise", format: inr },
    { header: "Due Date", key: "due_date", format: fmtDate },
    { header: "Status", key: "status", format: humanize },
  ],
  landowners: [
    { header: "Name", key: "full_name" },
    { header: "Phone", key: "phone" },
    { header: "Email", key: "email" },
    { header: "City", key: "city" },
    { header: "State", key: "state" },
    { header: "PAN", key: "pan_number" },
    { header: "Address", key: "address" },
  ],
  agencies: [
    { header: "Agency Name", key: "agency_name" },
    { header: "Contact Person", key: "contact_person" },
    { header: "Phone", key: "phone" },
    { header: "Email", key: "email" },
    { header: "City", key: "city" },
    { header: "State", key: "state" },
    { header: "GSTIN", key: "gstin" },
  ],
};

interface ListExportMenuProps {
  entityType: keyof typeof COLUMNS;
  data: Record<string, unknown>[];
  filenameBase: string;
}

export function ListExportMenu({ entityType, data, filenameBase }: ListExportMenuProps) {
  const columns = COLUMNS[entityType];
  if (!columns) return null;
  return <ExportMenu data={data} columns={columns} filenameBase={filenameBase} />;
}
