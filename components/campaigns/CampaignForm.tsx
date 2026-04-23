"use client";
import { useState, useMemo, useTransition, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Search, Save } from "lucide-react";
import { createCampaignSchema, type CreateCampaignValues } from "@/lib/validations/campaign";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import { SitePreviewModal } from "@/components/sites/SitePreviewModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr } from "@/lib/utils";
import { DurationSelector } from "@/components/shared/DurationSelector";
import type { Client, Site, PartnerAgency } from "@/lib/types/database";

interface Props {
  clients: Pick<Client, "id" | "company_name" | "brand_name">[];
  // Partner agencies — lets the user bill an agency, or earn a commission on
  // a client invoice for an agency that referred the business.
  agencies: Pick<PartnerAgency, "id" | "agency_name">[];
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

// Radio-card control for picking a billing mode. Rendered as a native radio
// input wrapped in a styled <label> so the whole card is clickable and
// keyboard-accessible out of the box.
function BillingModeOption({
  value,
  current,
  title,
  desc,
  register,
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

export function CampaignForm({ clients, agencies, sites, preselectedClientId, preselectedSiteId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDraftPending, startDraftTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [siteSearch, setSiteSearch] = useState("");
  const [durationMode, setDurationMode] = useState<"campaign" | "custom">("campaign");

  const { register, handleSubmit, watch, setValue, control, getValues, reset, formState: { errors, isDirty } } = useForm<CreateCampaignValues>({
    // Cast: z.preprocess() for NaN-safe optional numbers makes zod's
    // input type `unknown`, which trips up zodResolver's generics.
    // Matches the pattern in SiteForm.tsx.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createCampaignSchema) as any,
    defaultValues: {
      campaign_name: "",
      billing_party_type: "client",
      client_id: preselectedClientId ?? "",
      billed_agency_id: "",
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

  // ─── Local draft autosave ──────────────────────────────────────────────
  // Persist the in-progress form to localStorage so closing the tab /
  // refreshing the browser doesn't lose the user's typing. On mount,
  // offer to restore any leftover draft. Clears itself on successful
  // create / save-draft.
  const AUTOSAVE_KEY = "campaign-draft:new";
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSubmittedRef = useRef(false);
  const [autosaveStatus, setAutosaveStatus] = useState<
    "idle" | "saving" | "saved" | "restored"
  >("idle");

  // Restore on first mount. We do this in a layout-effect-free useEffect
  // so SSR stays clean; the draft only exists in the browser anyway.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<CreateCampaignValues> & {
        _savedAt?: number;
      };
      // Stale guard: drop anything older than 7 days so we don't
      // prompt users to restore something they've long forgotten.
      if (parsed?._savedAt && Date.now() - parsed._savedAt > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(AUTOSAVE_KEY);
        return;
      }
      // Only bother restoring if there was real content.
      const hasContent =
        (parsed.campaign_name && parsed.campaign_name.trim().length > 0) ||
        (parsed.sites && parsed.sites.length > 0) ||
        (parsed.services && parsed.services.length > 0);
      if (!hasContent) return;
      reset(parsed as CreateCampaignValues, { keepDefaultValues: false });
      setAutosaveStatus("restored");
      toast.info("Restored your unsaved campaign draft.");
    } catch {
      // ignore — corrupt / old-shape draft, just start fresh
      localStorage.removeItem(AUTOSAVE_KEY);
    }
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save on every form change. `watch()` with no args streams
  // the whole form state — perfect for cheap snapshots.
  useEffect(() => {
    const sub = watch((values) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        try {
          const snapshot = { ...values, _savedAt: Date.now() };
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
          setAutosaveStatus("saved");
        } catch {
          // Quota exceeded or disabled — fail silently.
        }
      }, 500);
    });
    return () => {
      sub.unsubscribe();
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [watch]);

  // beforeunload guard: warn if the user tries to close / navigate
  // away with unsaved work. The localStorage draft is still there, but
  // the browser shrug is useful so they don't accidentally lose the tab.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty || hasSubmittedRef.current) return;
      e.preventDefault();
      // Modern browsers ignore the message but require this to trigger
      // the prompt. Older ones show the returned string.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Helper: wipe the autosave entry after a successful submit so the
  // next /campaigns/new visit starts fresh.
  function clearAutosave() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* noop */
    }
    hasSubmittedRef.current = true;
  }

  // Auto-fill service quantity with the linked site's area (sqft) when
  // rate_basis is "per_sqft" and a site is picked. Tracks the last
  // auto-synced (rate_basis + site_id) per service so switching back to
  // a previous selection re-applies, but manual quantity edits stick —
  // we only sync when the trigger changes, not on every render.
  const lastSyncedPerSqft = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    watchedServices.forEach((svc, idx) => {
      const key = `${svc.rate_basis}|${svc.site_id ?? ""}`;
      const previous = lastSyncedPerSqft.current.get(idx);
      if (previous === key) return; // unchanged → respect any manual edits
      lastSyncedPerSqft.current.set(idx, key);

      if (svc.rate_basis !== "per_sqft") return;
      if (!svc.site_id) return;
      const site = siteMap.get(svc.site_id);
      if (!site?.total_sqft || site.total_sqft <= 0) return;
      setValue(`services.${idx}.quantity`, site.total_sqft, {
        shouldDirty: true,
        shouldValidate: true,
      });
    });
  }, [watchedServices, siteMap, setValue]);

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
      try {
        // Use the Route Handler (POST /api/campaigns) instead of a
        // Server Action directly. Route Handler URLs are stable across
        // deploys — Server Action URLs are content-hashed per build,
        // which means a browser with a cached client bundle from an
        // earlier deploy hits a 404 HTML page on submit and shows the
        // "An unexpected response was received from the server." error.
        const clean = sanitizeForTransport(values);
        const res = await fetch("/api/campaigns", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clean),
        });
        const data = await res.json().catch(() => ({ error: "Invalid server response" }));
        if (data?.error) { toast.error(data.error); return; }
        if (!data?.id) { toast.error("Unexpected server response"); return; }
        clearAutosave();
        toast.success("Campaign created");
        router.push(`/campaigns/${data.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  const selectedClient = clients.find((c) => c.id === watchedClientId);
  const watchedBillingType = watch("billing_party_type");
  const watchedAgencyId = watch("billed_agency_id");
  const selectedAgency = agencies.find((a) => a.id === watchedAgencyId);

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
          {/* ── Bill To ─────────────────────────────────────────────────────
              Three billing modes (see migration 024):
                1. Direct to Client              → client gets invoiced.
                2. Direct to Agency              → agency gets invoiced; client is
                                                   only a reference (the agency's
                                                   end customer).
                3. Client on Behalf of Agency    → client gets invoiced, agency
                                                   earns a commission billed separately.
              The radio selection shows/hides the fields below so the user
              sees only what's relevant for the selected mode.
          */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-foreground">
              Bill To <span className="text-destructive ml-0.5">*</span>
            </Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <BillingModeOption
                value="client"
                current={watchedBillingType}
                title="Client (direct)"
                desc="Invoice the client. No agency involved."
                register={register}
              />
              <BillingModeOption
                value="agency"
                current={watchedBillingType}
                title="Agency (direct)"
                desc="Invoice the agency. Client is optional — used as reference only."
                register={register}
              />
              <BillingModeOption
                value="client_on_behalf_of_agency"
                current={watchedBillingType}
                title="Client, agency commission"
                desc="Invoice the client; pay the agency a commission separately."
                register={register}
              />
            </div>
          </div>

          {/* End client picker — shown for 'client' and 'client_on_behalf_of_agency'.
              For 'agency' we still show it as OPTIONAL so users can record
              which end customer the agency is serving, but it's not required. */}
          {(watchedBillingType === "client" ||
            watchedBillingType === "client_on_behalf_of_agency" ||
            watchedBillingType === "agency") && (
            <F
              label={
                watchedBillingType === "agency"
                  ? "End Client (optional)"
                  : "Client"
              }
              error={errors.client_id?.message}
              required={watchedBillingType !== "agency"}
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
          )}

          {/* Agency picker — shown for 'agency' and 'client_on_behalf_of_agency'. */}
          {(watchedBillingType === "agency" ||
            watchedBillingType === "client_on_behalf_of_agency") && (
            <F
              label={
                watchedBillingType === "agency"
                  ? "Billed Agency"
                  : "Agency (earns commission)"
              }
              error={errors.billed_agency_id?.message}
              required
            >
              <NativeSelect
                {...register("billed_agency_id")}
                className={cn(errors.billed_agency_id && "border-destructive focus-visible:ring-destructive/40")}
              >
                <option value="">Select an agency…</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.agency_name}
                  </option>
                ))}
              </NativeSelect>
              {agencies.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No partner agencies yet. Add one from{" "}
                  <a href="/agencies/new" className="underline">
                    Agencies
                  </a>
                  .
                </p>
              )}
            </F>
          )}

          {/* Commission fields — only for client_on_behalf_of_agency. */}
          {watchedBillingType === "client_on_behalf_of_agency" && (
            <div className="grid grid-cols-2 gap-4 p-3 rounded-lg border border-dashed border-border bg-muted/30">
              <F
                label="Commission %"
                error={errors.agency_commission_percentage?.message}
              >
                <Input
                  {...register("agency_commission_percentage", { valueAsNumber: true })}
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  placeholder="e.g. 15"
                />
              </F>
              <F
                label="or Fixed Commission (₹)"
                error={errors.agency_commission_inr?.message}
              >
                <Input
                  {...register("agency_commission_inr", { valueAsNumber: true })}
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                />
              </F>
              <p className="text-xs text-muted-foreground col-span-2 -mt-1">
                Enter a percentage of the campaign value, OR a flat rupee amount.
                If both are set, the fixed amount takes precedence.
              </p>
            </div>
          )}
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

            // Total is always rate × quantity. For per-sqft, `quantity`
            // IS the area in sqft (auto-filled from the linked site's
            // width × height by the effect below); the server-side
            // total calc matches this convention.
            const serviceTotal = rateInr * qty;

            // Did we auto-fill the quantity from the site's area?
            // Surfaced as a small hint under the quantity input so the
            // user understands why it's pre-populated.
            const autoFilledFromSqft =
              rateBasis === "per_sqft" &&
              !!linkedSite?.total_sqft &&
              qty === linkedSite.total_sqft;

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

            // Calculate service totals. Quantity already carries the
            // area (sqft) for per_sqft rows — no double-multiply.
            const servicesTotals = values.services.map((s) => {
              const qty = s.quantity ?? 1;
              const rate = s.rate_inr ?? 0;
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
                    <p className="text-xs text-muted-foreground">Bill To</p>
                    <p className="font-medium text-foreground">
                      {values.billing_party_type === "client" && (
                        <>Client — {selectedClient?.company_name ?? "—"}</>
                      )}
                      {values.billing_party_type === "agency" && (
                        <>
                          Agency — {selectedAgency?.agency_name ?? "—"}
                          {selectedClient && (
                            <span className="text-muted-foreground font-normal">
                              {" "}(for {selectedClient.company_name})
                            </span>
                          )}
                        </>
                      )}
                      {values.billing_party_type === "client_on_behalf_of_agency" && (
                        <>
                          Client — {selectedClient?.company_name ?? "—"}
                          <span className="block text-xs text-muted-foreground font-normal">
                            Commission to {selectedAgency?.agency_name ?? "—"}
                            {values.agency_commission_inr
                              ? ` — ${inrAmount(values.agency_commission_inr)} fixed`
                              : values.agency_commission_percentage
                                ? ` — ${values.agency_commission_percentage}%`
                                : ""}
                          </span>
                        </>
                      )}
                    </p>
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
                const vals = getValues();
                if (!vals.campaign_name?.trim()) {
                  toast.error("Campaign name is required");
                  return;
                }
                // Billing-mode gatekeeping — match the server-side zod rules
                // so users don't get to Step 2 and then fail on submit.
                const bpt = vals.billing_party_type;
                if (bpt === "client" && !vals.client_id) {
                  toast.error("Select a client");
                  return;
                }
                if (bpt === "agency" && !vals.billed_agency_id) {
                  toast.error("Select the agency to bill");
                  return;
                }
                if (bpt === "client_on_behalf_of_agency") {
                  if (!vals.client_id) {
                    toast.error("Select the end client");
                    return;
                  }
                  if (!vals.billed_agency_id) {
                    toast.error("Select the agency earning the commission");
                    return;
                  }
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
              try {
                // Use /api/campaigns?mode=draft instead of the Server
                // Action to avoid the stale-action-hash class of errors.
                const clean = sanitizeForTransport(vals);
                const res = await fetch("/api/campaigns?mode=draft", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(clean),
                });
                const data = await res.json().catch(() => ({ error: "Invalid server response" }));
                if (data?.error) { toast.error(data.error); return; }
                if (!data?.id) { toast.error("Unexpected server response"); return; }
                clearAutosave();
                toast.success("Draft saved");
                router.push(`/campaigns/${data.id}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Save failed");
              }
            });
          }}
        >
          {isDraftPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Draft
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        {/* Autosave indicator — tells the user their typing is safe */}
        {autosaveStatus !== "idle" && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className={
                autosaveStatus === "saved"
                  ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                  : autosaveStatus === "restored"
                    ? "h-1.5 w-1.5 rounded-full bg-amber-500"
                    : "h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
              }
            />
            {autosaveStatus === "saved"
              ? "Draft auto-saved in this browser"
              : autosaveStatus === "restored"
                ? "Restored from your last session"
                : "Saving…"}
          </span>
        )}
      </div>
    </form>
  );
}
