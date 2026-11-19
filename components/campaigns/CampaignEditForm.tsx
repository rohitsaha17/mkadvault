"use client";
// Full-campaign edit form — basics + sites + services on one page.
//
// Design notes:
//   • Single page (no wizard). Edit is a quick-mutation flow, not an
//     onboarding flow — separate steps would just slow the user down.
//   • Sites / services ARRAYS carry row ids so the server can diff-sync
//     against the DB instead of DELETE+INSERT. That preserves per-row
//     side data (mounting_date, proof_photo_urls, creative_file_urls,
//     status) across edits.
//   • Pre-populated defaults come from the server-side edit page.

import { useMemo, useState, useTransition, useEffect } from "react";
import { useForm, useFieldArray, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Search } from "lucide-react";
import {
  editCampaignSchema,
  type EditCampaignValues,
} from "@/lib/validations/campaign";
import { callAction } from "@/lib/utils/call-action";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr as inrAmount } from "@/lib/utils";
import { DurationSelector } from "@/components/shared/DurationSelector";
import { SitePreviewModal } from "@/components/sites/SitePreviewModal";
import type { Campaign, Client, PartnerAgency, Site } from "@/lib/types/database";

type SiteMini = Pick<
  Site,
  "id" | "site_code" | "name" | "city" | "base_rate_paise" | "total_sqft" | "media_type"
>;

export interface ExistingSite {
  id: string;           // campaign_sites.id — present so we diff-sync
  site_id: string;
  rate_type: "per_month" | "fixed";
  display_rate_inr?: number;
  start_date?: string;
  end_date?: string;
  site_name: string;
  site_code: string;
  city: string;
  media_type: string;
  total_sqft: number | null;
}

export interface ExistingService {
  id: string;           // campaign_services.id
  service_type: "display_rental" | "flex_printing" | "mounting" | "design" | "transport" | "other";
  description?: string;
  quantity: number;
  rate_inr: number;
  site_id?: string;
  rate_basis: "per_sqft" | "lumpsum" | "other";
  other_label?: string;
}

interface Props {
  existing: Campaign;
  clients: Pick<Client, "id" | "company_name" | "brand_name">[];
  agencies: Pick<PartnerAgency, "id" | "agency_name">[];
  // Full picker list: available sites + the ones currently on this
  // campaign (even if their status is `booked`). De-duped server-side.
  pickerSites: SiteMini[];
  existingSites: ExistingSite[];
  existingServices: ExistingService[];
}

function F({ label, error, children, required }: {
  label: string; error?: string; children: React.ReactNode; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
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
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        props.className,
      )}
    />
  );
}

function BillingModeOption({
  value, current, title, desc, register,
}: {
  value: "client" | "agency" | "client_on_behalf_of_agency";
  current: string | undefined;
  title: string;
  desc: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
}) {
  const selected = current === value;
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="radio"
          value={value}
          {...register("billing_party_type")}
          className="mt-0.5 accent-primary"
        />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{desc}</p>
        </div>
      </div>
    </label>
  );
}

// Pro-rata helper mirrors lib/campaigns/derive.ts siteTotalPaise so the
// edit-form row totals match the server-computed campaign total.
function calcSiteTotal(
  rateInr: number,
  rateType: "per_month" | "fixed",
  start?: string,
  end?: string,
): number {
  if (!rateInr) return 0;
  if (rateType === "fixed") return rateInr;
  if (!start || !end) return 0;
  const startTs = new Date(start).getTime();
  const endTs = new Date(end).getTime();
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 0;
  const days = Math.max(
    1,
    Math.ceil((endTs - startTs) / (1000 * 60 * 60 * 24)) + 1,
  );
  return (rateInr * days) / 30;
}

export function CampaignEditForm({
  existing,
  clients,
  agencies,
  pickerSites,
  existingSites,
  existingServices,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [siteSearch, setSiteSearch] = useState("");
  const [durationMode, setDurationMode] = useState<"campaign" | "custom">(() => {
    // Detect current state: if every site's dates match the campaign,
    // default to "campaign"; otherwise "custom".
    if (existingSites.length === 0) return "campaign";
    const cs = existing.start_date;
    const ce = existing.end_date;
    const allMatch = existingSites.every(
      (s) =>
        (s.start_date ?? null) === (cs ?? null) &&
        (s.end_date ?? null) === (ce ?? null),
    );
    return allMatch ? "campaign" : "custom";
  });

  const siteMap = useMemo(
    () => new Map(pickerSites.map((s) => [s.id, s])),
    [pickerSites],
  );

  const { register, handleSubmit, watch, setValue, control, formState: { errors } } = useForm<EditCampaignValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(editCampaignSchema) as any,
    defaultValues: {
      campaign_name: existing.campaign_name,
      billing_party_type: existing.billing_party_type ?? "client",
      client_id: existing.client_id ?? "",
      billed_agency_id: existing.billed_agency_id ?? "",
      agency_commission_percentage:
        existing.agency_commission_percentage ?? undefined,
      agency_commission_inr:
        existing.agency_commission_paise != null
          ? existing.agency_commission_paise / 100
          : undefined,
      start_date: existing.start_date ?? "",
      end_date: existing.end_date ?? "",
      pricing_type: existing.pricing_type,
      total_value_inr:
        existing.total_value_paise != null
          ? existing.total_value_paise / 100
          : undefined,
      notes: existing.notes ?? "",
      sites: existingSites.map((s) => ({
        id: s.id,
        site_id: s.site_id,
        rate_type: s.rate_type,
        display_rate_inr: s.display_rate_inr,
        start_date: s.start_date,
        end_date: s.end_date,
      })),
      services: existingServices.map((s) => ({
        id: s.id,
        service_type: s.service_type,
        description: s.description,
        quantity: s.quantity,
        rate_inr: s.rate_inr,
        site_id: s.site_id,
        rate_basis: s.rate_basis,
        other_label: s.other_label,
      })),
    },
  });

  const pricingType = watch("pricing_type");
  const billingType = watch("billing_party_type");
  const campaignStart = watch("start_date") ?? "";
  const campaignEnd = watch("end_date") ?? "";
  const watchedSites = watch("sites") ?? [];
  const watchedServices = watch("services") ?? [];

  const { fields: siteFields, append: appendSite, remove: removeSite } = useFieldArray({
    control, name: "sites",
  });
  const { fields: serviceFields, append: appendService, remove: removeService } = useFieldArray({
    control, name: "services",
  });

  const siteIdsOnCampaign = useMemo(
    () => new Set((watchedSites ?? []).map((s) => s.site_id)),
    [watchedSites],
  );

  // Switching duration mode to "campaign" rewrites every row's dates
  // to the campaign window. Switching back to "custom" leaves them —
  // the user can edit per site.
  function handleDurationToggle(mode: "campaign" | "custom") {
    setDurationMode(mode);
    if (mode === "campaign" && campaignStart && campaignEnd) {
      watchedSites.forEach((_, idx) => {
        setValue(`sites.${idx}.start_date`, campaignStart);
        setValue(`sites.${idx}.end_date`, campaignEnd);
      });
    }
  }

  // Keep per-site dates in lockstep with the campaign window while in
  // "campaign" mode — if the user bumps the end date in the Basics
  // section, the site rows follow.
  useEffect(() => {
    if (durationMode !== "campaign" || !campaignStart || !campaignEnd) return;
    watchedSites.forEach((s, idx) => {
      if (s.start_date !== campaignStart) {
        setValue(`sites.${idx}.start_date`, campaignStart);
      }
      if (s.end_date !== campaignEnd) {
        setValue(`sites.${idx}.end_date`, campaignEnd);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMode, campaignStart, campaignEnd, watchedSites.length]);

  // Per-sqft service auto-fills quantity from the linked site's area.
  useEffect(() => {
    watchedServices.forEach((s, idx) => {
      if (s?.rate_basis !== "per_sqft") return;
      if (!s.site_id) return;
      const linked = siteMap.get(s.site_id);
      if (linked?.total_sqft && s.quantity !== linked.total_sqft) {
        setValue(`services.${idx}.quantity`, linked.total_sqft);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedServices.map((s) => `${s?.rate_basis}|${s?.site_id}`).join("|")]);

  function addSite(siteId: string) {
    const site = siteMap.get(siteId);
    if (!site) return;
    const baseRate = site.base_rate_paise ? site.base_rate_paise / 100 : undefined;
    appendSite({
      // No `id` for a newly-added site — the server inserts a fresh row.
      site_id: siteId,
      rate_type: "per_month",
      display_rate_inr: baseRate,
      start_date: durationMode === "custom" ? campaignStart : campaignStart,
      end_date: durationMode === "custom" ? campaignEnd : campaignEnd,
    });
  }

  function getSiteDates(idx: number): { start?: string; end?: string } {
    if (durationMode === "campaign") {
      return { start: campaignStart, end: campaignEnd };
    }
    return {
      start: watchedSites[idx]?.start_date,
      end: watchedSites[idx]?.end_date,
    };
  }

  const availableForPicker = useMemo(() => {
    const q = siteSearch.trim().toLowerCase();
    return pickerSites.filter((s) => {
      if (siteIdsOnCampaign.has(s.id)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.site_code.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q)
      );
    });
  }, [pricingType, pickerSites, siteIdsOnCampaign, siteSearch]);

  function onInvalid(formErrors: FieldErrors<EditCampaignValues>) {
    const leaf = findFirstError(formErrors);
    if (leaf) {
      toast.error(leaf.message || "Please fix the highlighted fields.");
    } else {
      toast.error("Please fix the highlighted fields before saving.");
    }
    console.warn("[CampaignEditForm] submit blocked by validation:", formErrors);
  }

  function onSubmit(values: EditCampaignValues) {
    // When the user is in "campaign-wide dates" mode, snap every site's
    // dates to the campaign window at submit time — defensive, in case
    // the live-sync effect above raced the submit.
    if (durationMode === "campaign" && values.sites) {
      values.sites = values.sites.map((s) => ({
        ...s,
        start_date: values.start_date,
        end_date: values.end_date,
      }));
    }

    const clean = sanitizeForTransport(values);
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string; id?: string }>(
          "updateCampaign",
          existing.id,
          clean,
        );
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success("Campaign updated");
        router.push(`/campaigns/${existing.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6 max-w-4xl">
      {/* ── Basics ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Basics</h2>

        <F label="Campaign Name" error={errors.campaign_name?.message} required>
          <Input
            {...register("campaign_name")}
            placeholder="e.g. Dove Summer 2026"
            className={cn(errors.campaign_name && "border-destructive focus-visible:ring-destructive/40")}
          />
        </F>

        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            Bill To <span className="text-destructive ml-0.5">*</span>
          </Label>
          <div className="grid gap-2 sm:grid-cols-3">
            <BillingModeOption
              value="client"
              current={billingType}
              title="Client (direct)"
              desc="Invoice the client. No agency involved."
              register={register}
            />
            <BillingModeOption
              value="agency"
              current={billingType}
              title="Agency (direct)"
              desc="Invoice the agency. Client is optional — reference only."
              register={register}
            />
            <BillingModeOption
              value="client_on_behalf_of_agency"
              current={billingType}
              title="Client, agency commission"
              desc="Invoice the client; pay the agency a commission separately."
              register={register}
            />
          </div>
        </div>

        <F
          label={billingType === "agency" ? "End Client (optional)" : "Client"}
          error={errors.client_id?.message}
          required={billingType !== "agency"}
        >
          <NativeSelect
            {...register("client_id")}
            className={cn(errors.client_id && "border-destructive focus-visible:ring-destructive/40")}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}{c.brand_name ? ` — ${c.brand_name}` : ""}
              </option>
            ))}
          </NativeSelect>
        </F>

        {(billingType === "agency" || billingType === "client_on_behalf_of_agency") && (
          <F
            label={billingType === "agency" ? "Billed Agency" : "Agency (earns commission)"}
            error={errors.billed_agency_id?.message}
            required
          >
            <NativeSelect
              {...register("billed_agency_id")}
              className={cn(errors.billed_agency_id && "border-destructive focus-visible:ring-destructive/40")}
            >
              <option value="">Select an agency…</option>
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>{a.agency_name}</option>
              ))}
            </NativeSelect>
          </F>
        )}

        {billingType === "client_on_behalf_of_agency" && (
          <div className="grid grid-cols-2 gap-4 p-3 rounded-lg border border-dashed border-border bg-muted/30">
            <F label="Commission %" error={errors.agency_commission_percentage?.message}>
              <Input
                {...register("agency_commission_percentage", { valueAsNumber: true })}
                type="number"
                step="0.01"
                min={0}
                max={100}
                placeholder="e.g. 15"
              />
            </F>
            <F label="or Fixed Commission (₹)" error={errors.agency_commission_inr?.message}>
              <Input
                {...register("agency_commission_inr", { valueAsNumber: true })}
                type="number"
                step="0.01"
                min={0}
                placeholder="0.00"
              />
            </F>
            <p className="text-xs text-muted-foreground col-span-2 -mt-1">
              Enter a percentage, OR a flat rupee amount. Fixed wins if both are set.
            </p>
          </div>
        )}

        <DurationSelector
          startDate={campaignStart}
          endDate={campaignEnd}
          onStartDateChange={(d) => setValue("start_date", d)}
          onEndDateChange={(d) => setValue("end_date", d)}
        />

        <div className="grid grid-cols-2 gap-4">
          <F label="Pricing Type" error={errors.pricing_type?.message} required>
            <NativeSelect {...register("pricing_type")}>
              <option value="itemized">Itemized</option>
              <option value="bundled">Bundled</option>
            </NativeSelect>
          </F>
          {pricingType === "bundled" && (
            <F label="Total Value (₹)" error={errors.total_value_inr?.message}>
              <Input
                {...register("total_value_inr", { valueAsNumber: true })}
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </F>
          )}
        </div>

        <F label="Notes" error={errors.notes?.message}>
          <Textarea {...register("notes")} placeholder="Internal notes…" rows={4} />
        </F>
      </section>

      {/* ── Sites ──────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-semibold text-foreground">Sites</h2>
          <span className="text-xs text-muted-foreground">
            {siteFields.length} on this campaign
          </span>
        </div>

        <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border">
          <span className="text-xs font-medium text-muted-foreground">Site Dates:</span>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="durationMode"
              checked={durationMode === "campaign"}
              onChange={() => handleDurationToggle("campaign")}
              className="accent-primary"
            />
            Same for all sites
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="durationMode"
              checked={durationMode === "custom"}
              onChange={() => handleDurationToggle("custom")}
              className="accent-primary"
            />
            Custom per site
          </label>
          {durationMode === "campaign" && campaignStart && campaignEnd && (
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              Using: {campaignStart} → {campaignEnd}
            </span>
          )}
          {durationMode === "campaign" && (!campaignStart || !campaignEnd) && (
            <span className="text-xs text-amber-600 ml-auto">Set campaign dates above</span>
          )}
        </div>

        {siteFields.length > 0 && (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Site</th>
                  <th className="text-left px-3 py-2 w-28">Rate Type</th>
                  <th className="text-left px-3 py-2 w-28">Rate (₹)</th>
                  <th className="text-left px-3 py-2 w-28">Total</th>
                  {durationMode === "custom" && (
                    <>
                      <th className="text-left px-3 py-2 w-32">Start</th>
                      <th className="text-left px-3 py-2 w-32">End</th>
                    </>
                  )}
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {siteFields.map((field, idx) => {
                  const site = siteMap.get(field.site_id);
                  const rateType = watchedSites[idx]?.rate_type ?? "per_month";
                  const rateInr = watchedSites[idx]?.display_rate_inr ?? 0;
                  const { start, end } = getSiteDates(idx);
                  const total = calcSiteTotal(rateInr, rateType, start, end);
                  return (
                    <tr key={field.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        {site ? (
                          <SitePreviewModal siteId={site.id}>
                            <span className="font-medium text-foreground text-xs hover:text-primary hover:underline text-left cursor-pointer">
                              {site.name}
                            </span>
                          </SitePreviewModal>
                        ) : (
                          <p className="font-medium text-foreground text-xs">{field.site_id}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {site?.site_code} · {site?.city}
                          {site?.total_sqft ? ` · ${site.total_sqft} sqft` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <NativeSelect
                          {...register(`sites.${idx}.rate_type`)}
                          className="h-8 text-xs w-full"
                        >
                          <option value="per_month">Per Month</option>
                          <option value="fixed">Fixed</option>
                        </NativeSelect>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          {...register(`sites.${idx}.display_rate_inr`, { valueAsNumber: true })}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="w-28 h-8 text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-foreground font-medium">
                        {total > 0 ? inrAmount(Math.round(total * 100)) : "—"}
                        {rateType === "per_month" && start && end && (
                          <p className="text-[10px] text-muted-foreground font-normal">
                            {Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1)} days
                          </p>
                        )}
                      </td>
                      {durationMode === "custom" && (
                        <>
                          <td className="px-3 py-2">
                            <Input {...register(`sites.${idx}.start_date`)} type="date" className="w-32 h-8 text-xs tabular-nums" />
                          </td>
                          <td className="px-3 py-2">
                            <Input {...register(`sites.${idx}.end_date`)} type="date" className="w-32 h-8 text-xs tabular-nums" />
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeSite(idx)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Remove site"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add-from-picker */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-medium text-muted-foreground">Available Sites</p>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={siteSearch}
                onChange={(e) => setSiteSearch(e.target.value)}
                placeholder="Search by name or code…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          {availableForPicker.length > 0 ? (
            <div className="rounded-xl border border-border overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {availableForPicker.map((site) => (
                    <tr key={site.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2.5">
                        <SitePreviewModal siteId={site.id}>
                          <span className="font-medium text-foreground hover:text-primary hover:underline text-left cursor-pointer">
                            {site.name}
                          </span>
                        </SitePreviewModal>
                        <p className="text-xs text-muted-foreground">
                          {site.site_code} · {site.city}
                          {site.total_sqft ? ` · ${site.total_sqft} sqft` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right w-24">
                        <button
                          type="button"
                          onClick={() => addSite(site.id)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
              {siteSearch ? "No sites match your search." : "No more available sites to add."}
            </p>
          )}
        </div>
      </section>

      {/* ── Services ───────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-semibold text-foreground">Services</h2>
          <button
            type="button"
            onClick={() =>
              appendService({
                // New row — no id yet, server will insert.
                service_type: "flex_printing",
                description: undefined,
                quantity: 1,
                rate_inr: 0,
                site_id: undefined,
                rate_basis: "lumpsum",
                other_label: undefined,
              })
            }
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Service
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Add printing, mounting, design or other charges. Skip entirely for bundled pricing.
        </p>

        {serviceFields.length === 0 && (
          <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
            <p className="text-sm">No services on this campaign.</p>
          </div>
        )}

        {serviceFields.map((field, idx) => {
          const rateBasis = watchedServices[idx]?.rate_basis ?? "lumpsum";
          const linkedSiteId = watchedServices[idx]?.site_id;
          const linkedSite = linkedSiteId ? siteMap.get(linkedSiteId) : undefined;
          const rateInr = watchedServices[idx]?.rate_inr ?? 0;
          const qty = watchedServices[idx]?.quantity ?? 1;
          const serviceTotal = rateInr * qty;
          const autoFilledFromSqft =
            rateBasis === "per_sqft" &&
            !!linkedSite?.total_sqft &&
            qty === linkedSite.total_sqft;

          return (
            <div key={field.id} className="rounded-xl border border-border p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Service {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeService(idx)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove service"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <F label="Type">
                  <NativeSelect {...register(`services.${idx}.service_type`)}>
                    <option value="display_rental">Display Rental</option>
                    <option value="flex_printing">Flex Printing</option>
                    <option value="mounting">Mounting</option>
                    <option value="design">Design</option>
                    <option value="transport">Transport</option>
                    <option value="other">Other</option>
                  </NativeSelect>
                </F>
                <F label="Linked Site (optional)">
                  <NativeSelect {...register(`services.${idx}.site_id`)}>
                    <option value="">Campaign-level</option>
                    {watchedSites.map((s) => {
                      const site = siteMap.get(s.site_id);
                      return (
                        <option key={s.site_id} value={s.site_id}>
                          {site?.name ?? s.site_id}
                        </option>
                      );
                    })}
                  </NativeSelect>
                </F>
                <F label="Rate Basis">
                  <NativeSelect {...register(`services.${idx}.rate_basis`)}>
                    <option value="lumpsum">Lumpsum</option>
                    <option value="per_sqft">Per Sq Ft</option>
                    <option value="other">Other</option>
                  </NativeSelect>
                </F>
              </div>
              {rateBasis === "other" && (
                <F label="Rate Label">
                  <Input
                    {...register(`services.${idx}.other_label`)}
                    placeholder="e.g. Per running ft, Per unit…"
                    className="h-8 text-sm"
                  />
                </F>
              )}
              <F label="Description">
                <Input {...register(`services.${idx}.description`)} placeholder="e.g. 10ft × 20ft flex printing" />
              </F>
              <div className="grid grid-cols-3 gap-3">
                <F label={rateBasis === "per_sqft" ? "Quantity (sqft)" : "Quantity"}>
                  <Input
                    {...register(`services.${idx}.quantity`, { valueAsNumber: true })}
                    type="number"
                    min={1}
                    step={rateBasis === "per_sqft" ? "0.01" : "1"}
                    defaultValue={1}
                  />
                  {autoFilledFromSqft && (
                    <p className="text-[10px] text-muted-foreground">
                      Auto-filled from {linkedSite?.name} area ({linkedSite?.total_sqft} sqft). Edit to override.
                    </p>
                  )}
                </F>
                <F label={rateBasis === "per_sqft" ? "Rate (₹/sqft)" : "Rate (₹)"}>
                  <Input
                    {...register(`services.${idx}.rate_inr`, { valueAsNumber: true })}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="tabular-nums"
                  />
                </F>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-foreground">Total</Label>
                  <p className="h-10 flex items-center text-sm font-medium tabular-nums text-foreground">
                    {serviceTotal > 0 ? inrAmount(Math.round(serviceTotal * 100)) : "—"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex gap-3 pt-2 border-t border-border">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Changes
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// Same DFS helper as CampaignForm — pulled inline so the two forms stay
// independently maintainable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFirstError(obj: any, prefix = ""): { path: string; message: string } | null {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.message === "string" && obj.message.length > 0) {
    return { path: prefix || "root", message: obj.message };
  }
  for (const key of Object.keys(obj)) {
    if (key === "ref" || key === "type") continue;
    const child = obj[key];
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const hit = findFirstError(child, nextPrefix);
    if (hit) return hit;
  }
  return null;
}
