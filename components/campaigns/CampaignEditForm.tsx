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
import type { Campaign, Client } from "@/lib/types/database";

interface Props {
  existing: Campaign;
  clients: Pick<Client, "id" | "company_name" | "brand_name">[];
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

export function CampaignEditForm({ existing, clients }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CampaignBasicsValues>({
    resolver: zodResolver(campaignBasicsSchema),
    defaultValues: {
      campaign_name: existing.campaign_name,
      client_id: existing.client_id,
      start_date: existing.start_date ?? "",
      end_date: existing.end_date ?? "",
      pricing_type: existing.pricing_type,
      total_value_inr: existing.total_value_paise != null ? existing.total_value_paise / 100 : undefined,
      notes: existing.notes ?? "",
    },
  });

  const pricingType = watch("pricing_type");

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
