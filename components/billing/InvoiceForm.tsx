"use client";
import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import { useForm, useFieldArray, useWatch, type FieldErrors } from "react-hook-form";
import { showFirstFormError } from "@/lib/utils/form-feedback";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";
// getCampaignLineItems is read-only (no mutation) and called on
// focus — keep the direct Server Action import for it since it's
// lower-risk than the create path. It could be moved to a GET
// Route Handler later if it ever breaks.
import { getCampaignLineItems } from "@/app/[locale]/(dashboard)/billing/actions";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import type { Client, Campaign, OrganizationBankAccount, PartnerAgency } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

type BankAccountLite = Pick<
  OrganizationBankAccount,
  "id" | "label" | "bank_name" | "account_number" | "ifsc_code" | "branch_name" | "is_primary"
>;

interface Props {
  clients: Pick<Client, "id" | "company_name" | "brand_name" | "gstin" | "credit_terms" | "billing_address" | "billing_city" | "billing_state">[];
  // A campaign may be billed to a client (billing_party_type='client')
  // or to an agency (billing_party_type='agency' + billed_agency_id).
  // The invoice form filters campaigns by whichever bill-to side the
  // user has picked, so we need both.
  campaigns: Pick<
    Campaign,
    | "id"
    | "campaign_name"
    | "client_id"
    | "pricing_type"
    | "total_value_paise"
    | "billing_party_type"
    | "billed_agency_id"
  >[];
  agencies?: Pick<PartnerAgency, "id" | "agency_name" | "gstin" | "state">[];
  orgGstin: string | null;
  defaultTerms: string;
  bankAccounts?: BankAccountLite[];
  preselectedClientId?: string;
  preselectedAgencyId?: string;
  preselectedCampaignId?: string;
  preselectedBillTo?: "client" | "agency";
  // Billing window — when provided (e.g. by the "extend campaign" flow)
  // the pre-populated line items are sized to this period, and each
  // line's own period defaults to it. Editing a line's period later
  // re-prorates the quantity on the fly.
  preselectedPeriodFrom?: string;
  preselectedPeriodTo?: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

// Coerce NaN / empty string to a safe default so a cleared HTML number
// input surfaces a meaningful validation message instead of Zod v4's
// "Expected number, received nan" that blocks submit.
const coerceNumberOrDefault = (fallback: number) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "number" && Number.isNaN(v)) return fallback;
    return v;
  }, z.number());

const lineItemSchema = z.object({
  service_type: z.enum(["display_rental", "flex_printing", "mounting", "design", "transport", "other"]),
  description: z.string().min(1, "Required"),
  hsn_sac_code: z.string(),
  quantity: coerceNumberOrDefault(1).pipe(z.number().positive("Must be > 0")),
  rate_inr: coerceNumberOrDefault(0).pipe(z.number().min(0, "Required")),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
  site_id: z.string().optional(),
  // Set when this line came from a specific campaign (used to group
  // lines on the PDF, and to show the invoice on the campaign page).
  campaign_id: z.string().optional(),
});

const formSchema = z.object({
  bill_to_type: z.enum(["client", "agency"]).default("client"),
  client_id: z.string().optional(),
  billed_agency_id: z.string().optional(),
  // campaign_ids holds the full selection; campaign_id mirrors the FIRST
  // selected one so the rest of the form (pricing-model badge, auto-load
  // line items) stays single-campaign simple. Multi-campaign invoices
  // produce one line GROUP per campaign in line_items.campaign_id.
  campaign_id: z.string().optional(),
  campaign_ids: z.array(z.string().uuid()).default([]),
  invoice_date: z.string().min(1, "Required"),
  due_date: z.string().min(1, "Required"),
  place_of_supply_state: z.string().optional(),
  bank_account_id: z.string().optional(),
  // Tally / external accounting reference. Finance teams raise the bill
  // in Tally and copy the number back here so the two systems reconcile.
  external_invoice_number: z.string().optional(),
  notes: z.string().optional(),
  terms_and_conditions: z.string().optional(),
  status: z.enum(["draft", "sent"]),
  line_items: z.array(lineItemSchema).min(1, "Add at least one line item"),
}).superRefine((d, ctx) => {
  if (d.bill_to_type === "client" && !d.client_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["client_id"], message: "Select a client" });
  }
  if (d.bill_to_type === "agency" && !d.billed_agency_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["billed_agency_id"], message: "Select an agency" });
  }
});

type FormValues = z.infer<typeof formSchema>;

const SERVICE_TYPES = [
  { value: "display_rental", label: "Display Rental" },
  { value: "flex_printing", label: "Flex Printing" },
  { value: "mounting", label: "Mounting" },
  { value: "design", label: "Design" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
] as const;

// ─── GST calculation ──────────────────────────────────────────────────────────

// GSTINs are exactly 15 chars; the first 2 are the state code. We
// only accept properly-shaped GSTINs as evidence for the state-code
// comparison so a malformed entry (e.g. "1") doesn't silently flip
// CGST/SGST → IGST. When either GSTIN is malformed we default to
// intra-state (CGST + SGST) — that's the safer fallback because
// CGST/SGST is collected in the supplier's state and IGST routes
// through a different account; mistakenly issuing IGST when it
// should have been split is harder to fix than the reverse.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const trimmed = gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(trimmed)) return null;
  return trimmed.slice(0, 2);
}

function calcGST(subtotalPaise: number, supplierGstin: string | null, buyerGstin: string | null) {
  const ss = gstinStateCode(supplierGstin);
  const bs = gstinStateCode(buyerGstin);
  // Inter-state only when BOTH GSTINs are well-formed AND their state
  // codes differ. Anything else falls back to intra-state.
  const isInter = !!(ss && bs && ss !== bs);
  const gst18 = Math.round(subtotalPaise * 0.18);
  return {
    cgst: isInter ? 0 : Math.round(gst18 / 2),
    sgst: isInter ? 0 : Math.round(gst18 / 2),
    igst: isInter ? gst18 : 0,
    is_inter_state: isInter,
    total: subtotalPaise + gst18,
  };
}

// ─── Credit terms → days ─────────────────────────────────────────────────────

const TERMS_DAYS: Record<string, number> = {
  advance: 0,
  net15: 15,
  net30: 30,
  net60: 60,
};

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Inclusive day count between two YYYY-MM-DD strings — matches the
// `rate × days / 30` pro-rata rule in lib/campaigns/derive.ts.
function daysInclusive(fromStr: string, toStr: string): number {
  const from = new Date(fromStr).getTime();
  const to = new Date(toStr).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1);
}

function F({ label, error, children, required }: {
  label: string; error?: string; children: React.ReactNode; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        props.className,
      )}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceForm({
  clients,
  campaigns,
  agencies = [],
  orgGstin,
  defaultTerms,
  bankAccounts = [],
  preselectedClientId,
  preselectedAgencyId,
  preselectedCampaignId,
  preselectedBillTo,
  preselectedPeriodFrom,
  preselectedPeriodTo,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loadingCampaign, setLoadingCampaign] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // Default to the primary bank account (or the first one). Admins set
  // "primary" in Settings so this picker is a no-op for the common case.
  const defaultBankId =
    bankAccounts.find((b) => b.is_primary)?.id ??
    bankAccounts[0]?.id ??
    "";

  // Infer bill-to type from the preselects (the Campaign Detail
  // "Create Invoice" button might pass an agency_id instead of a
  // client_id when the campaign is billed to an agency).
  const inferredBillTo: "client" | "agency" =
    preselectedBillTo ??
    (preselectedAgencyId ? "agency" : "client");

  const { register, handleSubmit, watch, control, setValue, setFocus, formState: { errors } } = useForm<FormValues>({
    // Cast: z.preprocess() on line_items.quantity / rate_inr makes zod's
    // input type `unknown`, which trips zodResolver's generics.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      bill_to_type: inferredBillTo,
      client_id: preselectedClientId ?? "",
      billed_agency_id: preselectedAgencyId ?? "",
      campaign_id: preselectedCampaignId ?? "",
      campaign_ids: preselectedCampaignId ? [preselectedCampaignId] : [],
      invoice_date: today,
      due_date: today,
      status: "draft",
      bank_account_id: defaultBankId,
      line_items: [{ service_type: "display_rental", description: "", hsn_sac_code: "998361", quantity: 1, rate_inr: 0 }],
      terms_and_conditions: defaultTerms,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "line_items" });
  const watchedItems = useWatch({ control, name: "line_items" });
  const watchedBillTo: "client" | "agency" = watch("bill_to_type");
  const watchedClientId = watch("client_id");
  const watchedAgencyId = watch("billed_agency_id");
  const watchedCampaignIds = watch("campaign_ids") ?? [];
  const watchedInvoiceDate = watch("invoice_date");

  const selectedClient = clients.find((c) => c.id === watchedClientId);
  const selectedAgency = agencies.find((a) => a.id === watchedAgencyId);
  const billToParty = watchedBillTo === "agency" ? selectedAgency : selectedClient;

  // Campaigns relevant to the current bill-to side.
  // • Direct-client invoices only show campaigns whose billing_party_type
  //   is 'client' AND client_id matches.
  // • Agency invoices show campaigns whose billing_party_type is
  //   'agency' AND billed_agency_id matches.
  const clientCampaigns = campaigns.filter((c) =>
    watchedBillTo === "agency"
      ? c.billing_party_type === "agency" && c.billed_agency_id === watchedAgencyId
      : (c.billing_party_type ?? "client") === "client" && c.client_id === watchedClientId,
  );

  // Track whether the user has manually typed Qty on each line. When
  // true, recomputeQtyFromDates leaves that line's quantity alone — so
  // setting a period after a manual Qty entry does NOT overwrite it.
  // Keyed by react-hook-form field id so it survives reorder / append.
  const qtyManuallyEditedRef = useRef<Record<string, boolean>>({});

  // Auto-set due date when client changes
  useEffect(() => {
    if (selectedClient && watchedInvoiceDate) {
      const days = TERMS_DAYS[selectedClient.credit_terms] ?? 30;
      setValue("due_date", addDays(watchedInvoiceDate, days));
    }
  }, [watchedClientId, watchedInvoiceDate, selectedClient, setValue]);

  // When the user swaps bill-to type, clear the opposite side and the
  // campaign selection so the form doesn't carry stale values across.
  useEffect(() => {
    if (watchedBillTo === "client") {
      setValue("billed_agency_id", "");
    } else {
      setValue("client_id", "");
    }
    setValue("campaign_id", "");
    setValue("campaign_ids", []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedBillTo]);

  // Load campaign line items when the campaign SET changes. When a
  // billing window is provided (via the extend-campaign redirect), the
  // server uses it to pro-rate each per-site rental line to that
  // window. For multi-campaign invoices we concat each campaign's lines
  // and tag every line with its source campaign_id.
  const loadLinesForCampaigns = useCallback(
    async (campaignIds: string[]) => {
      if (!campaignIds.length) return;
      setLoadingCampaign(true);
      try {
        const campaignIdToName = new Map(
          campaigns.map((c) => [c.id, c.campaign_name] as const),
        );
        const merged: {
          service_type: "display_rental" | "flex_printing" | "mounting" | "design" | "transport" | "other";
          description: string;
          hsn_sac_code: string;
          quantity: number;
          rate_inr: number;
          period_from?: string;
          period_to?: string;
          site_id?: string;
          campaign_id?: string;
        }[] = [];
        for (const cid of campaignIds) {
          const result = await getCampaignLineItems(
            cid,
            preselectedPeriodFrom,
            preselectedPeriodTo,
          );
          if ("error" in result) {
            toast.error(`${campaignIdToName.get(cid) ?? "Campaign"}: ${result.error}`);
            continue;
          }
          for (const item of result.items) {
            // Prefix the description with the campaign name when the
            // invoice covers more than one — otherwise the finance team
            // can't tell which campaign a line belongs to on the PDF.
            const prefix = campaignIds.length > 1 && campaignIdToName.get(cid)
              ? `[${campaignIdToName.get(cid)}] `
              : "";
            merged.push({ ...item, description: prefix + item.description, campaign_id: cid });
          }
        }
        if (merged.length > 0) {
          while (fields.length > 0) remove(0);
          merged.forEach((item) => append(item));
          // Reset the manual-Qty tracker: these are freshly loaded rows,
          // not user-typed quantities.
          qtyManuallyEditedRef.current = {};
          toast.info(
            campaignIds.length > 1
              ? `Line items loaded from ${campaignIds.length} campaigns`
              : "Line items loaded from campaign",
          );
        }
      } finally {
        setLoadingCampaign(false);
      }
    },
    [fields.length, remove, append, preselectedPeriodFrom, preselectedPeriodTo, campaigns],
  );

  // Mirror the FIRST campaign_id selection into campaign_id so legacy
  // single-campaign plumbing (pricing badge, invoices.campaign_id) stays
  // consistent with the multi-select. Depend on the joined id list so
  // a fresh array identity with the same values doesn't fire the
  // effect every render.
  const firstCampaignId = watchedCampaignIds[0] ?? "";
  useEffect(() => {
    setValue("campaign_id", firstCampaignId);
  }, [firstCampaignId, setValue]);

  // Fire line-item loader whenever the selection list changes. Depend on
  // the JOINED id list so a fresh array identity with the same values
  // doesn't re-trigger it.
  const campaignKey = watchedCampaignIds.join(",");
  useEffect(() => {
    if (campaignKey) {
      loadLinesForCampaigns(campaignKey.split(","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignKey]);

  // Pro-rata recalc: when a line's period dates change, re-set
  // `quantity` to the inclusive day count between them. Two guards keep
  // us from stepping on the user's toes:
  //   1. Only display_rental lines auto-compute Qty — flex/mounting/
  //      design etc. are flat charges where "qty" means something
  //      different (sheets printed, panels mounted, hours).
  //   2. If the user has typed in Qty themselves since this row loaded
  //      (tracked via qtyManuallyEditedRef, flipped on Qty onChange),
  //      we leave their value alone. Previously, setting a period AFTER
  //      typing Qty silently overwrote it with the day count.
  function recomputeQtyFromDates(idx: number) {
    const row = watchedItems?.[idx];
    if (!row) return;
    if (row.service_type && row.service_type !== "display_rental") return;
    const fieldId = fields[idx]?.id;
    if (fieldId && qtyManuallyEditedRef.current[fieldId]) return;
    const from = row.period_from;
    const to = row.period_to;
    if (!from || !to || to < from) return;
    const days = daysInclusive(from, to);
    if (days <= 0) return;
    setValue(`line_items.${idx}.quantity`, days, {
      shouldDirty: true,
      shouldValidate: false,
    });
  }

  function markQtyManuallyEdited(idx: number) {
    const fieldId = fields[idx]?.id;
    if (fieldId) qtyManuallyEditedRef.current[fieldId] = true;
  }

  // Calculated totals
  const subtotalPaise = (watchedItems ?? []).reduce((sum, item) => {
    return sum + Math.round((item.rate_inr ?? 0) * (item.quantity ?? 1) * 100);
  }, 0);

  const buyerGstin = watchedBillTo === "agency" ? selectedAgency?.gstin ?? null : selectedClient?.gstin ?? null;
  const gst = calcGST(subtotalPaise, orgGstin, buyerGstin);

  function onSubmit(values: FormValues, submitStatus: "draft" | "sent") {
    const finalValues = {
      ...values,
      status: submitStatus,
      // Normalise opt-out fields to undefined so the server schema's
      // emptyToUndefined preprocess sees "missing", not "". Without
      // this, a blank "Place of supply" field was coming through as
      // null → "Invalid input: expected string, received null".
      client_id: values.bill_to_type === "client" ? values.client_id || undefined : undefined,
      billed_agency_id: values.bill_to_type === "agency" ? values.billed_agency_id || undefined : undefined,
      campaign_id: values.campaign_id || undefined,
      bank_account_id: values.bank_account_id || undefined,
      place_of_supply_state: values.place_of_supply_state || undefined,
      external_invoice_number: values.external_invoice_number || undefined,
      notes: values.notes || undefined,
      terms_and_conditions: values.terms_and_conditions || undefined,
      subtotal_inr: subtotalPaise / 100,
      cgst_inr: gst.cgst / 100,
      sgst_inr: gst.sgst / 100,
      igst_inr: gst.igst / 100,
      total_inr: gst.total / 100,
      supplier_gstin: orgGstin,
      buyer_gstin: buyerGstin,
      is_inter_state: gst.is_inter_state,
    };

    // Sanitize NaN / Infinity / non-plain values before the Server Action
    // boundary — Flight transport rejects those and surfaces a cryptic
    // "An unexpected response was received from the server." error.
    const clean = sanitizeForTransport(finalValues);
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string; id?: string }>(
          "createInvoice",
          clean,
        );
        if ("error" in result) { toast.error(result.error); return; }
        toast.success(submitStatus === "draft" ? "Draft saved" : "Invoice created");
        router.push(`/billing/invoices/${result.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form className="space-y-6 max-w-5xl">
      {/* ── Bill-to party + Campaign ── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Invoice Details</h2>

        {/* Bill-to type switcher. Default is "client"; switch to
            "agency" when billing a partner agency (direct agency
            bookings or client_on_behalf_of_agency campaigns). */}
        <F label="Bill to">
          <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
            {([
              { value: "client", label: "Client" },
              { value: "agency", label: "Agency" },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "cursor-pointer px-4 py-1.5 text-sm rounded-md transition-colors",
                  watchedBillTo === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <input
                  type="radio"
                  value={opt.value}
                  {...register("bill_to_type")}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </F>

        <div className="grid grid-cols-2 gap-4">
          {watchedBillTo === "client" ? (
            <F label="Client" error={errors.client_id?.message} required>
              <NativeSelect {...register("client_id")} className={cn(errors.client_id && "border-destructive focus-visible:ring-destructive/40")}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_name}{c.brand_name ? ` — ${c.brand_name}` : ""}</option>
                ))}
              </NativeSelect>
            </F>
          ) : (
            <F label="Agency" error={errors.billed_agency_id?.message} required>
              <NativeSelect {...register("billed_agency_id")} className={cn(errors.billed_agency_id && "border-destructive focus-visible:ring-destructive/40")}>
                <option value="">Select agency…</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>{a.agency_name}</option>
                ))}
              </NativeSelect>
            </F>
          )}

          {/* Multi-campaign picker. One invoice can cover several
              campaigns (billed to the same client / agency). Each
              picked campaign appends its own line items, tagged via
              invoice_line_items.campaign_id so the PDF can group
              them. For the single-campaign case the checkbox list
              behaves exactly like a dropdown with one tick. */}
          <F label="Campaigns (optional)">
            {clientCampaigns.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-2">
                {(watchedBillTo === "client" ? !watchedClientId : !watchedAgencyId)
                  ? `Select a ${watchedBillTo === "client" ? "client" : "agency"} first.`
                  : `No campaigns on file for this ${watchedBillTo}.`}
              </p>
            ) : (
              <div className="rounded-md border border-border bg-background p-2 max-h-40 overflow-y-auto space-y-1.5">
                {clientCampaigns.map((c) => {
                  const checked = watchedCampaignIds.includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={loadingCampaign}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...watchedCampaignIds, c.id]
                            : watchedCampaignIds.filter((id) => id !== c.id);
                          setValue("campaign_ids", next, { shouldDirty: true });
                        }}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span className="text-foreground">{c.campaign_name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </F>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <F label="Invoice Date" error={errors.invoice_date?.message} required>
            <Input {...register("invoice_date")} type="date" />
          </F>
          <F label="Due Date" error={errors.due_date?.message} required>
            <Input {...register("due_date")} type="date" />
          </F>
          <F label="Place of Supply">
            <Input {...register("place_of_supply_state")} placeholder="e.g. Maharashtra" />
          </F>
        </div>

        {billToParty && (
          <div className="text-xs text-muted-foreground space-y-0.5 p-3 bg-muted rounded-md">
            {watchedBillTo === "client" && selectedClient ? (
              <>
                <p><strong className="text-foreground">Bill to:</strong> {selectedClient.company_name}</p>
                {selectedClient.billing_address && <p>{selectedClient.billing_address}, {selectedClient.billing_city}, {selectedClient.billing_state}</p>}
                {selectedClient.gstin && <p>GSTIN: {selectedClient.gstin}</p>}
              </>
            ) : watchedBillTo === "agency" && selectedAgency ? (
              <>
                <p><strong className="text-foreground">Bill to (agency):</strong> {selectedAgency.agency_name}</p>
                {selectedAgency.state && <p>State: {selectedAgency.state}</p>}
                {selectedAgency.gstin && <p>GSTIN: {selectedAgency.gstin}</p>}
              </>
            ) : null}
          </div>
        )}

        {/* ── Bank account to print on the invoice ── */}
        <F label="Receiving bank account">
          {bankAccounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No bank accounts on file. Add one under{" "}
              <Link href="/settings" className="text-primary underline">
                Settings → Organisation
              </Link>{" "}
              to print bank details on the invoice.
            </p>
          ) : (
            <NativeSelect {...register("bank_account_id")}>
              <option value="">Don&apos;t show bank details</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {(b.label || b.bank_name) +
                    (b.branch_name ? ` — ${b.branch_name}` : "") +
                    ` · A/C ${b.account_number.slice(-4).padStart(8, "•")}` +
                    (b.is_primary ? " (primary)" : "")}
                </option>
              ))}
            </NativeSelect>
          )}
        </F>
      </section>

      {/* ── Line Items ── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
          <button
            type="button"
            onClick={() => append({ service_type: "display_rental", description: "", hsn_sac_code: "998361", quantity: 1, rate_inr: 0 })}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium"
          >
            <Plus className="h-4 w-4" />Add Line Item
          </button>
        </div>

        {errors.line_items?.root && (
          <p className="text-xs text-destructive">{errors.line_items.root.message}</p>
        )}

        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-2">Type</th>
                <th className="text-left px-2 py-2">Description</th>
                <th className="text-left px-2 py-2">Period</th>
                <th className="text-left px-2 py-2 w-16">Qty</th>
                <th className="text-left px-2 py-2 w-28">Rate (₹)</th>
                <th className="text-left px-2 py-2 w-28">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, idx) => {
                const qty = watchedItems?.[idx]?.quantity ?? 1;
                const rate = watchedItems?.[idx]?.rate_inr ?? 0;
                const amt = Math.round(qty * rate * 100);
                return (
                  <tr key={field.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-2">
                      <NativeSelect {...register(`line_items.${idx}.service_type`)} className="w-32">
                        {SERVICE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        {...register(`line_items.${idx}.description`)}
                        placeholder="Description"
                        className={cn("min-w-48", errors.line_items?.[idx]?.description && "border-destructive focus-visible:ring-destructive/40")}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Input
                          {...register(`line_items.${idx}.period_from`)}
                          onBlur={() => recomputeQtyFromDates(idx)}
                          type="date"
                          className="w-32 text-xs tabular-nums"
                        />
                        <Input
                          {...register(`line_items.${idx}.period_to`)}
                          onBlur={() => recomputeQtyFromDates(idx)}
                          type="date"
                          className="w-32 text-xs tabular-nums"
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        {...register(`line_items.${idx}.quantity`, {
                          valueAsNumber: true,
                          onChange: () => markQtyManuallyEdited(idx),
                        })}
                        type="number"
                        min={0.01}
                        step="0.01"
                        className="w-16 tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input {...register(`line_items.${idx}.rate_inr`, { valueAsNumber: true })} type="number" step="0.01" className="w-28 tabular-nums" />
                    </td>
                    <td className="px-2 py-2 font-medium text-right text-foreground tabular-nums">{inr(amt)}</td>
                    <td className="px-2 py-2">
                      {fields.length > 1 && (
                        <button type="button" onClick={() => remove(idx)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* GST Summary */}
        <div className="border-t border-border pt-4 ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{inr(subtotalPaise)}</span>
          </div>
          {gst.is_inter_state ? (
            <div className="flex justify-between text-muted-foreground">
              <span>IGST (18%)</span>
              <span className="tabular-nums">{inr(gst.igst)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>CGST (9%)</span>
                <span className="tabular-nums">{inr(gst.cgst)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>SGST (9%)</span>
                <span className="tabular-nums">{inr(gst.sgst)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-bold text-foreground border-t border-border pt-1.5">
            <span>Total</span>
            <span className="tabular-nums">{inr(gst.total)}</span>
          </div>
          {orgGstin && selectedClient?.gstin && (
            <p className="text-xs text-muted-foreground">
              {gst.is_inter_state ? "Inter-state: IGST applied" : "Intra-state: CGST + SGST applied"}
            </p>
          )}
        </div>
      </section>

      {/* ── Notes & Terms ── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Notes & Terms</h2>
        <F label="Tally / External Bill Number">
          <Input
            {...register("external_invoice_number")}
            placeholder="e.g. 2026/104"
            maxLength={64}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Optional. The bill number from your Tally / external books, so the
            two systems reconcile when your accountant pulls receivables.
          </p>
        </F>
        <F label="Notes">
          <Textarea {...register("notes")} placeholder="Payment instructions, thank you note, etc." rows={2} />
        </F>
        <F label="Terms & Conditions">
          <Textarea {...register("terms_and_conditions")} rows={4} />
        </F>
      </section>

      {/* ── Submit ── */}
      <div className="flex gap-3 pt-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleSubmit(
            (v) => onSubmit(v, "draft"),
            (errs: FieldErrors<FormValues>) =>
              showFirstFormError(errs, { setFocus, label: "InvoiceForm (draft)" }),
          )}
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save as Draft
        </Button>
        <Button
          type="button"
          disabled={isPending}
          onClick={handleSubmit(
            (v) => onSubmit(v, "sent"),
            (errs: FieldErrors<FormValues>) =>
              showFirstFormError(errs, { setFocus, label: "InvoiceForm (sent)" }),
          )}
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create & Send
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
