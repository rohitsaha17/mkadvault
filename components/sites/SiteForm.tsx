"use client";
// SiteForm — 5-step form for creating / editing a site.
// Steps: 1 Basic Info → 2 Location → 3 Specs → 4 Commercial → 5 Notes/Review
// Photo upload is handled on the site detail page after the site is saved.
import { useState, useTransition } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ChevronLeft, ChevronRight, Check, Plus, Trash2, UserPlus } from "lucide-react";
import { siteSchema, siteFormDefaults, type SiteFormValues } from "@/lib/validations/site";
import { callAction } from "@/lib/utils/call-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import { IndianStateSelect } from "@/components/shared/IndianStateSelect";
import type { Site, Landowner } from "@/lib/types/database";

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { title: "Basic Info", desc: "Name, code, and type" },
  { title: "Location", desc: "Address and GPS" },
  { title: "Specifications", desc: "Dimensions and attributes" },
  { title: "Commercial", desc: "Ownership and rate" },
  { title: "Review", desc: "Confirm and save" },
] as const;

// Fields that belong to each step (for per-step validation)
const STEP_FIELDS: (keyof SiteFormValues)[][] = [
  ["name", "site_code", "media_type", "structure_type", "status"],
  ["address", "city", "state", "pincode", "landmark", "latitude", "longitude"],
  ["width_ft", "height_ft", "illumination", "facing", "traffic_side", "visibility_distance_m", "custom_dimensions"],
  ["ownership_model", "landowner_id", "base_rate_inr", "municipal_permission_number", "municipal_permission_expiry"],
  ["notes"],
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface SiteFormProps {
  // If editing, pass the existing site; otherwise it's a new-site form
  existingSite?: Site;
  // List of landowners in the current org — used by the commercial step's
  // landowner picker. Only shown when ownership_model = "owned".
  landowners?: Pick<Landowner, "id" | "full_name">[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteForm({ existingSite, landowners: initialLandowners = [] }: SiteFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  // Local copy so we can append a newly-created landowner without reloading
  // the whole page.
  const [landowners, setLandowners] = useState(initialLandowners);
  const [landownerDialogOpen, setLandownerDialogOpen] = useState(false);

  // Pre-fill defaults from existing site (edit mode)
  const defaultValues: Partial<SiteFormValues> = existingSite
    ? {
        name: existingSite.name,
        site_code: existingSite.site_code,
        media_type: existingSite.media_type,
        structure_type: existingSite.structure_type,
        status: existingSite.status,
        address: existingSite.address,
        city: existingSite.city,
        state: existingSite.state,
        pincode: existingSite.pincode ?? undefined,
        landmark: existingSite.landmark ?? undefined,
        latitude: existingSite.latitude ?? undefined,
        longitude: existingSite.longitude ?? undefined,
        width_ft: existingSite.width_ft ?? undefined,
        height_ft: existingSite.height_ft ?? undefined,
        illumination: existingSite.illumination ?? undefined,
        facing: existingSite.facing ?? undefined,
        traffic_side: existingSite.traffic_side ?? undefined,
        visibility_distance_m: existingSite.visibility_distance_m ?? undefined,
        ownership_model: existingSite.ownership_model,
        landowner_id: existingSite.landowner_id ?? undefined,
        // Convert stored paise back to INR for display
        base_rate_inr: existingSite.base_rate_paise
          ? existingSite.base_rate_paise / 100
          : undefined,
        municipal_permission_number: existingSite.municipal_permission_number ?? undefined,
        municipal_permission_expiry: existingSite.municipal_permission_expiry ?? undefined,
        notes: existingSite.notes ?? undefined,
        custom_dimensions: existingSite.custom_dimensions ?? [],
      }
    : siteFormDefaults;

  const {
    register,
    handleSubmit,
    trigger,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<SiteFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zodResolver's generic type can't express preprocess input↔output mismatch
    resolver: zodResolver(siteSchema) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- defaultValues typed as Partial<Output> but zod Input differs
    defaultValues: defaultValues as any,
    mode: "onTouched",
  });

  // Dynamic list of extra dimension rows (each has label + value).
  const {
    fields: dimensionFields,
    append: appendDimension,
    remove: removeDimension,
  } = useFieldArray({ control, name: "custom_dimensions" });

  const watchedWidth = watch("width_ft");
  const watchedHeight = watch("height_ft");
  const totalSqft =
    watchedWidth && watchedHeight
      ? (Number(watchedWidth) * Number(watchedHeight)).toFixed(2)
      : null;

  // Validate current step before advancing
  async function handleNext() {
    const fields = STEP_FIELDS[step];
    const valid = await trigger(fields);
    if (valid) setStep((s) => s + 1);
  }

  function handleBack() {
    setStep((s) => s - 1);
  }

  // Final submit — guarded so accidental submits (Enter key in an input on
  // earlier steps, or the form re-rendering the submit button between Next
  // clicks) don't create a site before the user reaches the Review step.
  function onSubmit(values: SiteFormValues) {
    if (step !== STEPS.length - 1) return;
    // Drop any empty custom dimension rows the user left behind.
    // Also sanitize NaN / Infinity / non-plain values so React Flight
    // transport doesn't reject the payload with the cryptic
    // "An unexpected response was received from the server." error.
    const cleaned = sanitizeForTransport({
      ...values,
      custom_dimensions: (values.custom_dimensions ?? []).filter(
        (d) => d.label.trim() && d.value.trim()
      ),
    });
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string; siteId?: string }>(
          existingSite ? "updateSite" : "createSite",
          ...(existingSite ? [existingSite.id, cleaned] : [cleaned]),
        );

        if ("error" in result) {
          toast.error(result.error);
          return;
        }

        toast.success(existingSite ? "Site updated" : "Site created");
        router.push(`/sites/${result.siteId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  // ── Inline landowner quick-create ──────────────────────────────────────
  // Lets the user add a landowner by just entering a name (+ optional phone
  // and email) without leaving the site form. Full details can be added
  // later from the Landowners page.
  const [lwName, setLwName] = useState("");
  const [lwPhone, setLwPhone] = useState("");
  const [lwEmail, setLwEmail] = useState("");
  const [lwSaving, setLwSaving] = useState(false);

  async function handleCreateLandowner() {
    if (!lwName.trim()) {
      toast.error("Enter a landowner name");
      return;
    }
    setLwSaving(true);
    try {
      const result = await callAction<{ error?: string; id?: string }>(
        "createLandowner",
        {
          full_name: lwName.trim(),
          phone: lwPhone.trim() || undefined,
          email: lwEmail.trim() || undefined,
        },
      );
      if (result.error || !result.id) {
        toast.error(result.error ?? "Failed to add landowner");
        return;
      }
      // Append to local list + select it
      const created = { id: result.id, full_name: lwName.trim() };
      setLandowners((prev) => [...prev, created]);
      setValue("landowner_id", result.id, { shouldValidate: true });
      toast.success("Landowner added");
      setLandownerDialogOpen(false);
      setLwName(""); setLwPhone(""); setLwEmail("");
    } finally {
      setLwSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Step progress indicator */}
      <nav>
        <ol className="flex items-center gap-0">
          {STEPS.map((s, i) => (
            <li key={i} className="flex items-center">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn(
                  "flex items-center gap-2 text-sm font-medium transition-colors",
                  i < step
                    ? "text-primary cursor-pointer"
                    : i === step
                    ? "text-foreground"
                    : "text-muted-foreground cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shrink-0",
                    i < step
                      ? "border-primary bg-primary text-primary-foreground"
                      : i === step
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s.title}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 w-8 lg:w-16",
                    i < step ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length} — {STEPS[step].desc}
        </p>
      </nav>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <form onSubmit={handleSubmit(onSubmit as any)} noValidate className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        {/* ── Step 1: Basic Info ───────────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Basic Information</h2>

            <FormField label="Site Name" error={errors.name?.message} required>
              <Input
                {...register("name")}
                placeholder="e.g. Bandra Flyover Billboard"
                className={cn(errors.name && "border-destructive focus-visible:ring-destructive/40")}
              />
            </FormField>

            <FormField
              label="Site Code"
              error={errors.site_code?.message}
              hint="Optional — auto-generated from the city if left blank"
            >
              <Input
                {...register("site_code")}
                placeholder="Auto-generated if blank (e.g. MUM-4F2A)"
                className={cn(errors.site_code && "border-destructive focus-visible:ring-destructive/40")}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Media Type" error={errors.media_type?.message} required>
                <NativeSelect
                  {...register("media_type")}
                  options={[
                    { value: "billboard", label: "Billboard" },
                    { value: "hoarding", label: "Hoarding" },
                    { value: "dooh", label: "DOOH (Digital)" },
                    { value: "kiosk", label: "Kiosk" },
                    { value: "wall_wrap", label: "Wall Wrap" },
                    { value: "unipole", label: "Unipole" },
                    { value: "bus_shelter", label: "Bus Shelter" },
                    { value: "custom", label: "Custom" },
                  ]}
                  error={!!errors.media_type}
                />
              </FormField>

              <FormField label="Structure Type" error={errors.structure_type?.message} required>
                <NativeSelect
                  {...register("structure_type")}
                  options={[
                    { value: "permanent", label: "Permanent" },
                    { value: "temporary", label: "Temporary" },
                    { value: "digital", label: "Digital" },
                  ]}
                  error={!!errors.structure_type}
                />
              </FormField>
            </div>

            <FormField label="Initial Status" error={errors.status?.message} required>
              <NativeSelect
                {...register("status")}
                options={[
                  { value: "available", label: "Available" },
                  { value: "maintenance", label: "Under Maintenance" },
                  { value: "blocked", label: "Blocked" },
                ]}
                error={!!errors.status}
              />
            </FormField>
          </div>
        )}

        {/* ── Step 2: Location ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Location</h2>

            <FormField label="Street Address" error={errors.address?.message} required>
              <Input
                {...register("address")}
                placeholder="e.g. Near HDFC Bank, Linking Road"
                className={cn(errors.address && "border-destructive focus-visible:ring-destructive/40")}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="City" error={errors.city?.message} required>
                <Input
                  {...register("city")}
                  placeholder="e.g. Mumbai"
                  className={cn(errors.city && "border-destructive focus-visible:ring-destructive/40")}
                />
              </FormField>
              <FormField label="State" error={errors.state?.message} required>
                <IndianStateSelect
                  {...register("state")}
                  error={!!errors.state}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Pincode" error={errors.pincode?.message}>
                <Input {...register("pincode")} placeholder="e.g. 400050" />
              </FormField>
              <FormField label="Landmark" error={errors.landmark?.message}>
                <Input
                  {...register("landmark")}
                  placeholder="Nearby landmark"
                />
              </FormField>
            </div>

            <p className="text-sm font-medium text-foreground">
              GPS Coordinates{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional)
              </span>
            </p>
            <p className="text-xs text-muted-foreground -mt-3">
              Leave blank if you don&apos;t know them yet — you can add coordinates
              later by editing the site. Or enter manually / use the map picker below.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Latitude" error={errors.latitude?.message}>
                <Input
                  {...register("latitude", { valueAsNumber: true })}
                  type="number"
                  step="any"
                  placeholder="e.g. 19.0760"
                />
              </FormField>
              <FormField label="Longitude" error={errors.longitude?.message}>
                <Input
                  {...register("longitude", { valueAsNumber: true })}
                  type="number"
                  step="any"
                  placeholder="e.g. 72.8777"
                />
              </FormField>
            </div>

            {/* Google Maps picker — shown only when API key is present */}
            <GoogleMapsPicker
              latitude={watch("latitude")}
              longitude={watch("longitude")}
              onPick={(lat, lng) => {
                setValue("latitude", lat, { shouldValidate: true });
                setValue("longitude", lng, { shouldValidate: true });
              }}
            />
          </div>
        )}

        {/* ── Step 3: Specifications ──────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Specifications</h2>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Width (ft)" error={errors.width_ft?.message} required>
                <Input
                  {...register("width_ft", { valueAsNumber: true })}
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 40"
                  className={cn(errors.width_ft && "border-destructive focus-visible:ring-destructive/40")}
                />
              </FormField>
              <FormField label="Height (ft)" error={errors.height_ft?.message} required>
                <Input
                  {...register("height_ft", { valueAsNumber: true })}
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 20"
                  className={cn(errors.height_ft && "border-destructive focus-visible:ring-destructive/40")}
                />
              </FormField>
            </div>

            {totalSqft && (
              <p className="text-sm text-muted-foreground">
                Total area: <span className="font-semibold text-foreground">{totalSqft} sq.ft.</span>
              </p>
            )}

            {/* Custom dimensions — free-form label/value pairs for anything
                beyond width × height (e.g. "Depth", "Pole Height"). */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-foreground">
                  Additional Dimensions
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => appendDimension({ label: "", value: "" })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add dimension
                </Button>
              </div>
              {dimensionFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Optional — add measurements like depth, pole height, or panel
                  thickness if they apply to this structure.
                </p>
              ) : (
                <div className="space-y-2">
                  {dimensionFields.map((f, idx) => (
                    <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
                      <div>
                        <Input
                          {...register(`custom_dimensions.${idx}.label` as const)}
                          placeholder="Dimension name (e.g. Depth)"
                          className={cn(
                            errors.custom_dimensions?.[idx]?.label &&
                              "border-destructive focus-visible:ring-destructive/40"
                          )}
                        />
                        {errors.custom_dimensions?.[idx]?.label && (
                          <p className="text-xs text-destructive mt-1">
                            {errors.custom_dimensions[idx]?.label?.message}
                          </p>
                        )}
                      </div>
                      <div>
                        <Input
                          {...register(`custom_dimensions.${idx}.value` as const)}
                          placeholder="Measurement (e.g. 3 ft)"
                          className={cn(
                            errors.custom_dimensions?.[idx]?.value &&
                              "border-destructive focus-visible:ring-destructive/40"
                          )}
                        />
                        {errors.custom_dimensions?.[idx]?.value && (
                          <p className="text-xs text-destructive mt-1">
                            {errors.custom_dimensions[idx]?.value?.message}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDimension(idx)}
                        aria-label="Remove dimension"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Illumination" error={errors.illumination?.message} required>
                <NativeSelect
                  {...register("illumination")}
                  options={[
                    { value: "", label: "— Select —" },
                    { value: "frontlit", label: "Front-lit" },
                    { value: "backlit", label: "Back-lit" },
                    { value: "digital", label: "Digital" },
                    { value: "nonlit", label: "Non-lit" },
                  ]}
                  error={!!errors.illumination}
                />
              </FormField>

              <FormField label="Traffic Side" error={errors.traffic_side?.message} required>
                <NativeSelect
                  {...register("traffic_side")}
                  options={[
                    { value: "", label: "— Select —" },
                    { value: "lhs", label: "Left Hand Side" },
                    { value: "rhs", label: "Right Hand Side" },
                    { value: "both", label: "Both Sides" },
                  ]}
                  error={!!errors.traffic_side}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Facing Direction" error={errors.facing?.message}>
                <NativeSelect
                  {...register("facing")}
                  options={[
                    { value: "", label: "— Select —" },
                    { value: "N", label: "North" },
                    { value: "S", label: "South" },
                    { value: "E", label: "East" },
                    { value: "W", label: "West" },
                    { value: "NE", label: "North-East" },
                    { value: "NW", label: "North-West" },
                    { value: "SE", label: "South-East" },
                    { value: "SW", label: "South-West" },
                  ]}
                  error={!!errors.facing}
                />
              </FormField>

              <FormField
                label="Visibility Distance (m)"
                error={errors.visibility_distance_m?.message}
              >
                <Input
                  {...register("visibility_distance_m", { valueAsNumber: true })}
                  type="number"
                  min="0"
                  placeholder="e.g. 500"
                />
              </FormField>
            </div>
          </div>
        )}

        {/* ── Step 4: Commercial ──────────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Commercial Details</h2>

            <FormField label="Ownership Model" error={errors.ownership_model?.message} required>
              <NativeSelect
                {...register("ownership_model")}
                options={[
                  { value: "owned", label: "Owned" },
                  { value: "rented", label: "Rented" },
                ]}
                error={!!errors.ownership_model}
              />
            </FormField>

            {/* Landowner picker — only meaningful for owned sites. Rented sites
                are linked to a partner agency via the contracts module. The
                "+ Add" button opens a quick-create dialog so the user doesn't
                have to leave the site form. */}
            {watch("ownership_model") === "owned" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">Landowner</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setLandownerDialogOpen(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Add landowner
                  </Button>
                </div>
                <NativeSelect
                  {...register("landowner_id")}
                  options={[
                    { value: "", label: "— Unlinked —" },
                    ...landowners.map((l) => ({ value: l.id, label: l.full_name })),
                  ]}
                  error={!!errors.landowner_id}
                />
                {errors.landowner_id?.message ? (
                  <p className="text-xs text-destructive">{errors.landowner_id.message}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {landowners.length === 0
                      ? "No landowners yet — click Add landowner to create one inline."
                      : "Link this site to the person/entity who owns the land."}
                  </p>
                )}
              </div>
            )}

            <FormField
              label="Base Monthly Rate (₹)"
              error={errors.base_rate_inr?.message}
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
                  ₹
                </span>
                <Input
                  {...register("base_rate_inr", { valueAsNumber: true })}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 50000"
                  className="pl-7"
                />
              </div>
            </FormField>

            <FormField
              label="Municipal Permit Number"
              error={errors.municipal_permission_number?.message}
            >
              <Input
                {...register("municipal_permission_number")}
                placeholder="e.g. BMC/OOH/2024/12345"
              />
            </FormField>

            <FormField
              label="Permit Expiry Date"
              error={errors.municipal_permission_expiry?.message}
            >
              <Input
                {...register("municipal_permission_expiry")}
                type="date"
              />
            </FormField>
          </div>
        )}

        {/* ── Step 5: Review ──────────────────────────────────────────────── */}
        {step === 4 && (
          <ReviewStep values={watch()} existingSite={existingSite} />
        )}

        {/* ── Navigation buttons ───────────────────────────────────────────── */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Button
            type="button"
            variant="outline"
            onClick={step === 0 ? () => {} : handleBack}
            disabled={step === 0}
            className={cn(step === 0 && "invisible")}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={handleNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {existingSite ? "Save Changes" : "Create Site"}
            </Button>
          )}
        </div>
      </form>

      {/* ── Inline landowner quick-create dialog ─────────────────────────────
          Minimum-info popup so the user can add a landowner mid-flow. The
          rest of the landowner's details (PAN, bank, address, etc.) can be
          filled in later from the Landowners module. */}
      <Dialog open={landownerDialogOpen} onOpenChange={setLandownerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Landowner</DialogTitle>
            <DialogDescription>
              Just the basics for now — you can fill in the rest from the Landowners page later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input
                value={lwName}
                onChange={(e) => setLwName(e.target.value)}
                placeholder="e.g. Rakesh Sharma"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={lwPhone}
                  onChange={(e) => setLwPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={lwEmail}
                  onChange={(e) => setLwEmail(e.target.value)}
                  placeholder="e.g. name@example.com"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLandownerDialogOpen(false)}
              disabled={lwSaving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateLandowner} disabled={lwSaving}>
              {lwSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save landowner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── ReviewStep ───────────────────────────────────────────────────────────────
// Shows a summary of all entered values before final submit.

function ReviewStep({
  values,
  existingSite,
}: {
  values: SiteFormValues;
  existingSite?: Site;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">
        {existingSite ? "Review Changes" : "Review & Create"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {existingSite
          ? "Confirm the changes below, then click Save Changes."
          : "Confirm the details below, then click Create Site. You can add photos after saving."}
      </p>

      <div className="rounded-lg border border-border divide-y divide-border text-sm">
        <ReviewRow label="Site Name" value={values.name} />
        <ReviewRow label="Site Code" value={values.site_code} />
        <ReviewRow label="Media Type" value={values.media_type?.replace(/_/g, " ")} />
        <ReviewRow label="Structure" value={values.structure_type} />
        <ReviewRow label="Status" value={values.status} />
        <ReviewRow label="Address" value={`${values.address}, ${values.city}, ${values.state}`} />
        {values.pincode && <ReviewRow label="Pincode" value={values.pincode} />}
        {values.latitude && values.longitude && (
          <ReviewRow label="GPS" value={`${values.latitude}, ${values.longitude}`} />
        )}
        {(values.width_ft || values.height_ft) && (
          <ReviewRow
            label="Dimensions"
            value={`${values.width_ft ?? "?"} × ${values.height_ft ?? "?"} ft`}
          />
        )}
        {values.custom_dimensions && values.custom_dimensions.filter((d) => d.label && d.value).length > 0 && (
          <ReviewRow
            label="Other Dimensions"
            value={values.custom_dimensions
              .filter((d) => d.label && d.value)
              .map((d) => `${d.label}: ${d.value}`)
              .join(", ")}
          />
        )}
        {values.illumination && <ReviewRow label="Illumination" value={values.illumination} />}
        {values.facing && <ReviewRow label="Facing" value={values.facing} />}
        <ReviewRow label="Ownership" value={values.ownership_model} />
        {values.base_rate_inr && (
          <ReviewRow
            label="Monthly Rate"
            value={new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 0,
            }).format(values.base_rate_inr)}
          />
        )}
        {values.notes && <ReviewRow label="Notes" value={values.notes} />}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string | number }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 px-4 py-2.5">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-foreground capitalize">{value}</span>
    </div>
  );
}

// ─── GoogleMapsPicker ─────────────────────────────────────────────────────────
// Shows an embedded map only when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set.
// Clicking on the map updates the lat/lng fields.

function GoogleMapsPicker({
  latitude,
  longitude,
  onPick: _onPick,
}: {
  latitude?: number;
  longitude?: number;
  onPick: (lat: number, lng: number) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return (
      <p className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
        Map picker not available. Add{" "}
        <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to enable.
      </p>
    );
  }

  // Basic iframe embed for picking — clicking opens Google Maps
  const center = latitude && longitude ? `${latitude},${longitude}` : "20.5937,78.9629";
  const embedSrc = `https://maps.google.com/maps?q=${center}&z=14&output=embed&t=m`;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Enter coordinates manually above, or use Google Maps to find the location.
      </p>
      <iframe
        src={embedSrc}
        className="w-full h-48 rounded-md border border-border"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Site location preview"
      />
    </div>
  );
}

// ─── FormField helper ─────────────────────────────────────────────────────────

function FormField({
  label,
  children,
  error,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── NativeSelect helper ──────────────────────────────────────────────────────
// A plain <select> styled with Tailwind — simpler than shadcn Select for forms
// because it works with react-hook-form's `register()` directly.

import React from "react";

interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  error?: boolean;
}

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ options, error, className, ...props }, ref) {
    return (
      <select
        ref={ref}
        {...props}
        className={cn(
          "w-full h-10 rounded-md border bg-background px-3 py-2 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          error
            ? "border-destructive focus-visible:ring-destructive/40"
            : "border-input hover:border-ring/50",
          className
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
);
