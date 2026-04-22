"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { campaignBasicsSchema, type CampaignBasicsValues } from "@/lib/validations/campaign";
import { updateCampaign } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DurationSelector } from "@/components/shared/DurationSelector";
import type { Campaign, Client, PartnerAgency } from "@/lib/types/database";

interface Props {
  existing: Campaign;
  clients: Pick<Client, "id" | "company_name" | "brand_name">[];
  agencies: Pick<PartnerAgency, "id" | "agency_name">[];
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

// Same radio-card pattern used in CampaignForm — kept local so the two forms
// can evolve independently without a shared component contract.
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

export function CampaignEditForm({ existing, clients, agencies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CampaignBasicsValues>({
    resolver: zodResolver(campaignBasicsSchema),
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
      total_value_inr: existing.total_value_paise != null ? existing.total_value_paise / 100 : undefined,
      notes: existing.notes ?? "",
    },
  });

  const pricingType = watch("pricing_type");
  const billingType = watch("billing_party_type");

  function onSubmit(values: CampaignBasicsValues) {
    startTransition(async () => {
      const result = await updateCampaign(existing.id, values);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success("Campaign updated");
      router.push(`/campaigns/${existing.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-4xl">
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
      <F label="Campaign Name" error={errors.campaign_name?.message} required>
        <Input
          {...register("campaign_name")}
          placeholder="e.g. Dove Summer 2026"
          className={cn(errors.campaign_name && "border-destructive focus-visible:ring-destructive/40")}
        />
      </F>

      {/* Bill To — three modes. See CampaignForm.tsx / migration 024. */}
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
        startDate={watch("start_date") ?? ""}
        endDate={watch("end_date") ?? ""}
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
