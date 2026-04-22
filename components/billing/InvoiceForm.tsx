"use client";
import { useState, useTransition, useEffect, useCallback } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr } from "@/lib/utils";
import { createInvoice, getCampaignLineItems } from "@/app/[locale]/(dashboard)/billing/actions";
import type { Client, Campaign } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  clients: Pick<Client, "id" | "company_name" | "brand_name" | "gstin" | "credit_terms" | "billing_address" | "billing_city" | "billing_state">[];
  campaigns: Pick<Campaign, "id" | "campaign_name" | "client_id" | "pricing_type" | "total_value_paise">[];
  orgGstin: string | null;
  defaultTerms: string;
  preselectedClientId?: string;
  preselectedCampaignId?: string;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const lineItemSchema = z.object({
  service_type: z.enum(["display_rental", "flex_printing", "mounting", "design", "transport", "other"]),
  description: z.string().min(1, "Required"),
  hsn_sac_code: z.string(),
  quantity: z.number().positive(),
  rate_inr: z.number().min(0, "Required"),
  period_from: z.string().optional(),
  period_to: z.string().optional(),
  site_id: z.string().optional(),
});

const formSchema = z.object({
  client_id: z.string().uuid("Select a client"),
  campaign_id: z.string().optional(),
  invoice_date: z.string().min(1, "Required"),
  due_date: z.string().min(1, "Required"),
  place_of_supply_state: z.string().optional(),
  notes: z.string().optional(),
  terms_and_conditions: z.string().optional(),
  status: z.enum(["draft", "sent"]),
  line_items: z.array(lineItemSchema).min(1, "Add at least one line item"),
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

function calcGST(subtotalPaise: number, supplierGstin: string | null, buyerGstin: string | null) {
  const ss = supplierGstin?.slice(0, 2);
  const bs = buyerGstin?.slice(0, 2);
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
  orgGstin,
  defaultTerms,
  preselectedClientId,
  preselectedCampaignId,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loadingCampaign, setLoadingCampaign] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const { register, handleSubmit, watch, control, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      client_id: preselectedClientId ?? "",
      campaign_id: preselectedCampaignId ?? "",
      invoice_date: today,
      due_date: today,
      status: "draft",
      line_items: [{ service_type: "display_rental", description: "", hsn_sac_code: "998361", quantity: 1, rate_inr: 0 }],
      terms_and_conditions: defaultTerms,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "line_items" });
  const watchedItems = useWatch({ control, name: "line_items" });
  const watchedClientId = watch("client_id");
  const watchedCampaignId = watch("campaign_id");
  const watchedInvoiceDate = watch("invoice_date");

  const selectedClient = clients.find((c) => c.id === watchedClientId);
  const clientCampaigns = campaigns.filter((c) => c.client_id === watchedClientId);

  // Auto-set due date when client changes
  useEffect(() => {
    if (selectedClient && watchedInvoiceDate) {
      const days = TERMS_DAYS[selectedClient.credit_terms] ?? 30;
      setValue("due_date", addDays(watchedInvoiceDate, days));
    }
  }, [watchedClientId, watchedInvoiceDate, selectedClient, setValue]);

  // Load campaign line items when campaign changes
  const loadCampaignItems = useCallback(async (campaignId: string) => {
    if (!campaignId) return;
    setLoadingCampaign(true);
    try {
      const result = await getCampaignLineItems(campaignId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.items.length > 0) {
        // Replace line items
        while (fields.length > 0) remove(0);
        result.items.forEach((item) => append(item));
        toast.info("Line items loaded from campaign");
      }
    } finally {
      setLoadingCampaign(false);
    }
  }, [fields.length, remove, append]);

  useEffect(() => {
    if (watchedCampaignId) {
      loadCampaignItems(watchedCampaignId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedCampaignId]);

  // Calculated totals
  const subtotalPaise = (watchedItems ?? []).reduce((sum, item) => {
    return sum + Math.round((item.rate_inr ?? 0) * (item.quantity ?? 1) * 100);
  }, 0);

  const gst = calcGST(subtotalPaise, orgGstin, selectedClient?.gstin ?? null);

  function onSubmit(values: FormValues, submitStatus: "draft" | "sent") {
    const finalValues = {
      ...values,
      status: submitStatus,
      subtotal_inr: subtotalPaise / 100,
      cgst_inr: gst.cgst / 100,
      sgst_inr: gst.sgst / 100,
      igst_inr: gst.igst / 100,
      total_inr: gst.total / 100,
      supplier_gstin: orgGstin,
      buyer_gstin: selectedClient?.gstin,
      is_inter_state: gst.is_inter_state,
    };

    startTransition(async () => {
      const result = await createInvoice(finalValues);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success(submitStatus === "draft" ? "Draft saved" : "Invoice created");
      router.push(`/billing/invoices/${result.id}`);
    });
  }

  return (
    <form className="space-y-6 max-w-5xl">
      {/* ── Client + Campaign ── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Invoice Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <F label="Client" error={errors.client_id?.message} required>
            <NativeSelect {...register("client_id")} className={cn(errors.client_id && "border-destructive focus-visible:ring-destructive/40")}>
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}{c.brand_name ? ` — ${c.brand_name}` : ""}</option>
              ))}
            </NativeSelect>
          </F>
          <F label="Campaign (optional)">
            <NativeSelect {...register("campaign_id")} disabled={!watchedClientId || loadingCampaign}>
              <option value="">Select campaign…</option>
              {clientCampaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.campaign_name}</option>
              ))}
            </NativeSelect>
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

        {selectedClient && (
          <div className="text-xs text-muted-foreground space-y-0.5 p-3 bg-muted rounded-md">
            <p><strong className="text-foreground">Bill to:</strong> {selectedClient.company_name}</p>
            {selectedClient.billing_address && <p>{selectedClient.billing_address}, {selectedClient.billing_city}, {selectedClient.billing_state}</p>}
            {selectedClient.gstin && <p>GSTIN: {selectedClient.gstin}</p>}
          </div>
        )}
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
                        <Input {...register(`line_items.${idx}.period_from`)} type="date" className="w-32 text-xs tabular-nums" />
                        <Input {...register(`line_items.${idx}.period_to`)} type="date" className="w-32 text-xs tabular-nums" />
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Input {...register(`line_items.${idx}.quantity`, { valueAsNumber: true })} type="number" min={0.01} step="0.01" className="w-16 tabular-nums" />
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
          onClick={handleSubmit((v) => onSubmit(v, "draft"))}
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save as Draft
        </Button>
        <Button
          type="button"
          disabled={isPending}
          onClick={handleSubmit((v) => onSubmit(v, "sent"))}
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create & Send
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
