"use client";
import { useState, useMemo, useTransition } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Search, Save } from "lucide-react";
import { createCampaignSchema, type CreateCampaignValues } from "@/lib/validations/campaign";
import { createCampaign, saveCampaignDraft } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { SitePreviewModal } from "@/components/sites/SitePreviewModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr } from "@/lib/utils";
import { DurationSelector } from "@/components/shared/DurationSelector";
import type { Client, Site } from "@/lib/types/database";

interface Props {
  clients: Pick<Client, "id" | "company_name" | "brand_name">[];
  sites: Pick<Site, "id" | "site_code" | "name" | "city" | "base_rate_paise" | "total_sqft" | "media_type">[];
  preselectedClientId?: string;
  // When launching the form from a site page, pre-add this site to the sites
  // step so the user only has to pick a client and dates.
  preselectedSiteId?: string;
}

const STEPS = [
  { key: "basics", label: "Basics" },
  { key: "sites", label: "Sites" },
  { key: "services", label: "Services" },
  { key: "summary", label: "Summary" },
] as const;

const SERVICE_TYPES = [
  { value: "display_rental", label: "Display Rental" },
  { value: "flex_printing", label: "Flex Printing" },
  { value: "mounting", label: "Mounting" },
  { value: "design", label: "Design" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
] as const;

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

function inrAmount(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);
}

// Calculate total for a site based on rate type and dates
function calcSiteTotal(rateInr: number, rateType: string, startDate?: string, endDate?: string): number {
  if (!rateInr) return 0;
  if (rateType === "fixed") return rateInr;
  // per_month: rate × days / 30
  if (rateType === "per_month" && startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    return rateInr * days / 30;
  }
  return rateInr; // fallback if no dates
}

export function CampaignForm({ clients, sites, preselectedClientId, preselectedSiteId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDraftPending, startDraftTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [siteSearch, setSiteSearch] = useState("");
  const [durationMode, setDurationMode] = useState<"campaign" | "custom">("campaign");

  const { register, handleSubmit, watch, setValue, control, getValues, formState: { errors } } = useForm<CreateCampaignValues>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: {
      campaign_name: "",
      client_id: preselectedClientId ?? "",
      pricing_type: "itemized",
      // If launched from a site page, pre-add that site with its base rate as
      // the display rate so the booking flow starts with one row already.
      sites: preselectedSiteId && sites.some((s) => s.id === preselectedSiteId)
        ? [{
            site_id: preselectedSiteId,
            rate_type: "per_month" as const,
            display_rate_inr: (() => {
              const s = sites.find((x) => x.id === preselectedSiteId);
              return s?.base_rate_paise ? s.base_rate_paise / 100 : undefined;
            })(),
          }]
        : [],
      services: [],
    },
  });

  const { fields: siteFields, append: appendSite, remove: removeSite } = useFieldArray({ control, name: "sites" });
  const { fields: serviceFields, append: appendService, remove: removeService } = useFieldArray({ control, name: "services" });

  const pricingType = watch("pricing_type");
  const watchedSites = watch("sites");
  const watchedServices = watch("services");
  const watchedClientId = watch("client_id");
  const campaignStart = watch("start_date");
  const campaignEnd = watch("end_date");

  // Sites already added (by site_id)
  const addedSiteIds = new Set(watchedSites.map((s) => s.site_id));
  const availableSites = useMemo(() => {
    let filtered = sites.filter((s) => !addedSiteIds.has(s.id));
    if (siteSearch.trim()) {
      const q = siteSearch.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(q) || s.site_code.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [sites, addedSiteIds, siteSearch]);

  // Site map for quick lookup
  const siteMap = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);

  function handleDurationToggle(mode: "campaign" | "custom") {
    if (mode === "campaign" && durationMode === "custom" && siteFields.length > 0) {
      const ok = window.confirm(
        "Switching to 'Same for all' will clear custom dates on all sites and use campaign dates instead. Continue?"
      );
      if (!ok) return;
      // Clear per-site dates
      siteFields.forEach((_, idx) => {
        setValue(`sites.${idx}.start_date`, undefined);
        setValue(`sites.${idx}.end_date`, undefined);
      });
    }
    setDurationMode(mode);
  }

  function addSite(siteId: string) {
    const site = siteMap.get(siteId);
    const baseRate = site?.base_rate_paise ? site.base_rate_paise / 100 : undefined;
    appendSite({
      site_id: siteId,
      rate_type: "per_month",
      display_rate_inr: baseRate,
      start_date: durationMode === "custom" ? campaignStart : undefined,
      end_date: durationMode === "custom" ? campaignEnd : undefined,
    });
  }

  function onSubmit(values: CreateCampaignValues) {
    // If duration mode is "campaign", override site dates with campaign dates
    if (durationMode === "campaign") {
      values.sites = values.sites.map((s) => ({
        ...s,
        start_date: values.start_date,
        end_date: values.end_date,
      }));
    }
    startTransition(async () => {
      const result = await createCampaign(values);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Campaign created");
      router.push(`/campaigns/${result.id}`);
    });
  }

  const selectedClient = clients.find((c) => c.id === watchedClientId);

  // Helper to get effective dates for a site entry
  function getSiteDates(idx: number): { start?: string; end?: string } {
    if (durationMode === "campaign") {
      return { start: campaignStart, end: campaignEnd };
    }
    return { start: watchedSites[idx]?.start_date, end: watchedSites[idx]?.end_date };
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-4xl">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <button
              type="button"
              onClick={() => { if (i < step) setStep(i); }}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                step === i
                  ? "bg-primary text-primary-foreground"
                  : i < step
                  ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                  : "bg-muted text-muted-foreground cursor-default"
              )}
            >
              <span className={cn(
                "w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold tabular-nums",
                step === i ? "bg-background text-primary" : i < step ? "bg-primary text-primary-foreground" : "bg-muted-foreground/30 text-muted-foreground"
              )}>{i + 1}</span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px w-6 mx-1", i < step ? "bg-primary" : "bg-border")} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 0: Basics ─────────────────────────────────────────────────── */}
      {step === 0 && (
        <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Campaign Basics</h2>
          <F label="Campaign Name" error={errors.campaign_name?.message} required>
            <Input
              {...register("campaign_name")}
              placeholder="e.g. Dove Summer 2026"
              className={cn(errors.campaign_name && "border-destructive focus-visible:ring-destructive/40")}
            />
          </F>
          <F label="Client" error={errors.client_id?.message} required>
            <NativeSelect {...register("client_id")} className={cn(errors.client_id && "border-destructive focus-visible:ring-destructive/40")}>
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}{c.brand_name ? ` — ${c.brand_name}` : ""}
                </option>
              ))}
            </NativeSelect>
          </F>
          <DurationSelector
            startDate={watch("start_date") ?? ""}
            endDate={watch("end_date") ?? ""}
            onStartDateChange={(d) => setValue("start_date", d)}
            onEndDateChange={(d) => setValue("end_date", d)}
          />
          <div className="grid grid-cols-2 gap-4">
            <F label="Pricing Type" error={errors.pricing_type?.message} required>
              <NativeSelect {...register("pricing_type")}>
                <option value="itemized">Itemized (per site + services)</option>
                <option value="bundled">Bundled (single total value)</option>
              </NativeSelect>
            </F>
            {pricingType === "bundled" && (
              <F label="Total Campaign Value (₹)" error={errors.total_value_inr?.message}>
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
            <Textarea {...register("notes")} placeholder="Internal notes…" rows={3} />
          </F>
        </section>
      )}

      {/* ── Step 1: Sites ──────────────────────────────────────────────────── */}
      {step === 1 && (
        <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Add Sites</h2>

          {/* Duration mode toggle */}
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
              <span className="text-xs text-amber-600 ml-auto">Set campaign dates in Step 1</span>
            )}
          </div>

          {/* Sites already added */}
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
                          {total > 0 ? inrAmount(Math.round(total)) : "—"}
                          {rateType === "per_month" && start && end && (
                            <p className="text-[10px] text-muted-foreground font-normal">
                              {Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1} days
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
                          <button type="button" onClick={() => removeSite(idx)} className="text-muted-foreground hover:text-destructive">
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

          {/* Site search + available sites */}
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

            {availableSites.length > 0 ? (
              <div className="rounded-xl border border-border overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {availableSites.map((site) => (
                      <tr key={site.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2.5">
                          <SitePreviewModal siteId={site.id}>
                            <span className="font-medium text-foreground hover:text-primary hover:underline text-left cursor-pointer">
                              {site.name}
                            </span>
                          </SitePreviewModal>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-mono">{site.site_code}</span> · {site.city}
                            {site.media_type && ` · ${site.media_type.replace(/_/g, " ")}`}
                            {site.total_sqft ? ` · ${site.total_sqft} sqft` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {inr(site.base_rate_paise)}/mo
                        </td>
                        <td className="px-3 py-2.5 text-right">
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
              <p className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                {siteSearch ? "No sites match your search." : siteFields.length === sites.length ? "All available sites added." : "No available sites."}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Step 2: Services ───────────────────────────────────────────────── */}
      {step === 2 && (
        <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-sm font-semibold text-foreground">Services</h2>
            <button
              type="button"
              onClick={() => appendService({ service_type: "flex_printing", description: undefined, quantity: 1, rate_inr: 0, site_id: undefined, rate_basis: "lumpsum", other_label: undefined })}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Service
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Add printing, mounting, design or other charges. Skip if using bundled pricing.</p>

          {serviceFields.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
              <p className="text-sm">No services added. Click &ldquo;Add Service&rdquo; to add one, or continue to skip.</p>
            </div>
          )}

          {serviceFields.map((field, idx) => {
            const rateBasis = watchedServices[idx]?.rate_basis ?? "lumpsum";
            const linkedSiteId = watchedServices[idx]?.site_id;
            const linkedSite = linkedSiteId ? siteMap.get(linkedSiteId) : undefined;
            const rateInr = watchedServices[idx]?.rate_inr ?? 0;
            const qty = watchedServices[idx]?.quantity ?? 1;

            // Calculate total based on rate basis
            let serviceTotal = rateInr * qty;
            if (rateBasis === "per_sqft" && linkedSite?.total_sqft) {
              serviceTotal = rateInr * linkedSite.total_sqft * qty;
            }

            return (
              <div key={field.id} className="rounded-xl border border-border p-4 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Service {idx + 1}</span>
                  <button type="button" onClick={() => removeService(idx)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <F label="Type">
                    <NativeSelect {...register(`services.${idx}.service_type`)}>
                      {SERVICE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
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
                    <Input {...register(`services.${idx}.other_label`)} placeholder="e.g. Per running ft, Per unit…" className="h-8 text-sm" />
                  </F>
                )}
                <F label="Description">
                  <Input {...register(`services.${idx}.description`)} placeholder="e.g. 10ft × 20ft flex printing" />
                </F>
                <div className="grid grid-cols-3 gap-3">
                  <F label="Quantity">
                    <Input
                      {...register(`services.${idx}.quantity`, { valueAsNumber: true })}
                      type="number"
                      min={1}
                      defaultValue={1}
                    />
                  </F>
                  <F label={rateBasis === "per_sqft" ? "Rate (₹/sqft)" : rateBasis === "other" ? `Rate (₹)` : "Rate (₹)"}>
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
                      {serviceTotal > 0 ? inrAmount(Math.round(serviceTotal)) : "—"}
                      {rateBasis === "per_sqft" && linkedSite?.total_sqft && (
                        <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                          ({linkedSite.total_sqft} sqft)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── Step 3: Summary ────────────────────────────────────────────────── */}
      {step === 3 && (
        <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Review & Create</h2>

          {(() => {
            const values = getValues();
            // Calculate site totals
            const sitesTotals = values.sites.map((s, i) => {
              const { start, end } = getSiteDates(i);
              const effectiveStart = durationMode === "campaign" ? values.start_date : s.start_date;
              const effectiveEnd = durationMode === "campaign" ? values.end_date : s.end_date;
              return calcSiteTotal(s.display_rate_inr ?? 0, s.rate_type ?? "per_month", effectiveStart, effectiveEnd);
            });
            const sitesTotal = sitesTotals.reduce((a, b) => a + b, 0);

            // Calculate service totals
            const servicesTotals = values.services.map((s) => {
              const qty = s.quantity ?? 1;
              const rate = s.rate_inr ?? 0;
              if (s.rate_basis === "per_sqft" && s.site_id) {
                const site = siteMap.get(s.site_id);
                return rate * (site?.total_sqft ?? 0) * qty;
              }
              return rate * qty;
            });
            const servicesTotal = servicesTotals.reduce((a, b) => a + b, 0);

            const grandTotal = values.pricing_type === "bundled" ? (values.total_value_inr ?? 0) : sitesTotal + servicesTotal;

            return (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Campaign Name</p>
                    <p className="font-medium text-foreground">{values.campaign_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Client</p>
                    <p className="font-medium text-foreground">{selectedClient?.company_name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dates</p>
                    <p className="font-medium text-foreground tabular-nums">{values.start_date || "—"} → {values.end_date || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pricing</p>
                    <p className="font-medium text-foreground capitalize">{values.pricing_type}</p>
                  </div>
                </div>

                {/* Sites breakdown */}
                {values.sites.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Sites ({values.sites.length})</p>
                    {values.sites.map((s, i) => {
                      const site = siteMap.get(s.site_id);
                      return (
                        <div key={s.site_id} className="flex justify-between text-xs py-1">
                          <span className="text-foreground">
                            {site?.name ?? s.site_id}
                            <span className="text-muted-foreground ml-1">
                              ({s.rate_type === "per_month" ? "per month" : "fixed"})
                            </span>
                          </span>
                          <span className="tabular-nums text-foreground">{inrAmount(Math.round(sitesTotals[i]))}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Services breakdown */}
                {values.services.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Services ({values.services.length})</p>
                    {values.services.map((s, i) => (
                      <div key={i} className="flex justify-between text-xs py-1">
                        <span className="text-foreground">
                          {SERVICE_TYPES.find((t) => t.value === s.service_type)?.label ?? s.service_type}
                          {s.description && <span className="text-muted-foreground ml-1">— {s.description}</span>}
                        </span>
                        <span className="tabular-nums text-foreground">{inrAmount(Math.round(servicesTotals[i]))}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-border pt-3 space-y-1">
                  {values.pricing_type === "itemized" && (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Sites subtotal</span>
                        <span className="tabular-nums">{inrAmount(Math.round(sitesTotal))}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Services subtotal</span>
                        <span className="tabular-nums">{inrAmount(Math.round(servicesTotal))}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1 mt-1">
                    <span>Total Value</span>
                    <span className="tabular-nums">{inrAmount(Math.round(grandTotal))}</span>
                  </div>
                </div>

                {values.notes && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p className="text-foreground mt-0.5">{values.notes}</p>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {/* Footer nav */}
      <div className="flex gap-3 pt-2 border-t border-border">
        {step > 0 && (
          <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={() => {
              // Validate current step before advancing
              if (step === 0) {
                const name = getValues("campaign_name");
                if (!name?.trim()) {
                  toast.error("Campaign name is required");
                  return;
                }
              }
              // Steps 1 (Sites) and 2 (Services) have no required validation
              setStep(step + 1);
            }}
          >
            Continue
          </Button>
        ) : (
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Campaign
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={isDraftPending}
          onClick={() => {
            const vals = getValues();
            if (!vals.campaign_name?.trim()) {
              toast.error("Campaign name is required to save draft");
              return;
            }
            startDraftTransition(async () => {
              const result = await saveCampaignDraft(vals);
              if ("error" in result) { toast.error(result.error); return; }
              toast.success("Draft saved");
              router.push(`/campaigns/${result.id}`);
            });
          }}
        >
          {isDraftPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Draft
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
