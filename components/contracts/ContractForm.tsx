"use client";
import { useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { contractSchema, contractDefaults, type ContractFormValues } from "@/lib/validations/contract";
import { createContract, updateContract } from "@/app/[locale]/(dashboard)/contracts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Contract, Site, Landowner, PartnerAgency } from "@/lib/types/database";

interface Props {
  existing?: Contract;
  sites: Pick<Site, "id" | "name" | "site_code" | "city">[];
  landowners: Pick<Landowner, "id" | "full_name" | "phone">[];
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

// Native select wrapped to match Input styling
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

export function ContractForm({ existing, sites, landowners, agencies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaults: ContractFormValues = existing ? {
    contract_type: existing.contract_type,
    landowner_id: existing.landowner_id ?? undefined,
    agency_id: existing.agency_id ?? undefined,
    site_id: existing.site_id,
    payment_model: existing.payment_model,
    rent_amount_inr: existing.rent_amount_paise ? existing.rent_amount_paise / 100 : undefined,
    payment_day_of_month: existing.payment_day_of_month ?? undefined,
    payment_date: existing.payment_date ?? undefined,
    revenue_share_percentage: existing.revenue_share_percentage ?? undefined,
    minimum_guarantee_inr: existing.minimum_guarantee_paise
      ? existing.minimum_guarantee_paise / 100 : undefined,
    escalation_percentage: existing.escalation_percentage ?? undefined,
    escalation_frequency_months: existing.escalation_frequency_months ?? undefined,
    start_date: existing.start_date,
    end_date: existing.end_date ?? undefined,
    renewal_date: existing.renewal_date ?? undefined,
    notice_period_days: existing.notice_period_days,
    lock_period_months: existing.lock_period_months ?? undefined,
    early_termination_clause: existing.early_termination_clause ?? undefined,
    notes: existing.notes ?? undefined,
  } : contractDefaults as ContractFormValues;

  const { register, handleSubmit, watch, control, formState: { errors } } = useForm<ContractFormValues>({
    resolver: zodResolver(contractSchema),
    defaultValues: defaults,
  });

  const contractType = watch("contract_type");
  const paymentModel = watch("payment_model");

  function onSubmit(values: ContractFormValues) {
    startTransition(async () => {
      const result = existing
        ? await updateContract(existing.id, values)
        : await createContract(values);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success(existing ? "Contract updated" : "Contract created");
      router.push(`/contracts/${result.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-4xl">

      {/* Contract type + party */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Contract Party</h2>

        <F label="Contract Type" required>
          <Controller
            name="contract_type"
            control={control}
            render={({ field }) => (
              <NativeSelect {...field}>
                <option value="landowner">Landowner</option>
                <option value="agency">Agency</option>
              </NativeSelect>
            )}
          />
        </F>

        {contractType === "landowner" && (
          <F label="Landowner" error={errors.landowner_id?.message} required>
            <Controller
              name="landowner_id"
              control={control}
              render={({ field }) => (
                <NativeSelect
                  {...field}
                  value={field.value ?? ""}
                  className={cn(errors.landowner_id && "border-destructive focus-visible:ring-destructive/40")}
                >
                  <option value="">— Select landowner —</option>
                  {landowners.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.full_name}{l.phone ? ` · ${l.phone}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </F>
        )}

        {contractType === "agency" && (
          <F label="Agency" error={errors.agency_id?.message} required>
            <Controller
              name="agency_id"
              control={control}
              render={({ field }) => (
                <NativeSelect
                  {...field}
                  value={field.value ?? ""}
                  className={cn(errors.agency_id && "border-destructive focus-visible:ring-destructive/40")}
                >
                  <option value="">— Select agency —</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>{a.agency_name}</option>
                  ))}
                </NativeSelect>
              )}
            />
          </F>
        )}

        <F label="Site" error={errors.site_id?.message} required>
          <Controller
            name="site_id"
            control={control}
            render={({ field }) => (
              <NativeSelect
                {...field}
                className={cn(errors.site_id && "border-destructive focus-visible:ring-destructive/40")}
              >
                <option value="">— Select site —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.site_code ? `(${s.site_code})` : ""}{s.city ? ` · ${s.city}` : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
        </F>
      </section>

      {/* Payment model */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Payment Terms</h2>

        <F label="Payment Model" required>
          <Controller
            name="payment_model"
            control={control}
            render={({ field }) => (
              <NativeSelect {...field}>
                <option value="monthly_fixed">Monthly Fixed</option>
                <option value="yearly_lumpsum">Yearly Lump Sum</option>
                <option value="revenue_share">Revenue Share</option>
                <option value="custom">Custom</option>
              </NativeSelect>
            )}
          />
        </F>

        {/* Monthly fixed / custom */}
        {(paymentModel === "monthly_fixed" || paymentModel === "custom") && (
          <div className="grid grid-cols-2 gap-4">
            <F label="Monthly Rent (₹)" error={errors.rent_amount_inr?.message} required>
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register("rent_amount_inr", { valueAsNumber: true })}
                placeholder="e.g. 15000"
                className={cn(errors.rent_amount_inr && "border-destructive focus-visible:ring-destructive/40")}
              />
            </F>
            <F label="Payment Day of Month" error={errors.payment_day_of_month?.message}>
              <Input
                type="number"
                min={1}
                max={28}
                {...register("payment_day_of_month", { valueAsNumber: true })}
                placeholder="e.g. 5"
              />
            </F>
          </div>
        )}

        {/* Yearly lump sum */}
        {paymentModel === "yearly_lumpsum" && (
          <div className="grid grid-cols-2 gap-4">
            <F label="Annual Amount (₹)" error={errors.rent_amount_inr?.message} required>
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register("rent_amount_inr", { valueAsNumber: true })}
                placeholder="e.g. 180000"
                className={cn(errors.rent_amount_inr && "border-destructive focus-visible:ring-destructive/40")}
              />
            </F>
            <F label="Annual Payment Date" error={errors.payment_date?.message}>
              <Input type="date" {...register("payment_date")} />
            </F>
          </div>
        )}

        {/* Revenue share */}
        {paymentModel === "revenue_share" && (
          <div className="grid grid-cols-2 gap-4">
            <F label="Revenue Share %" error={errors.revenue_share_percentage?.message} required>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                {...register("revenue_share_percentage", { valueAsNumber: true })}
                placeholder="e.g. 25"
                className={cn(errors.revenue_share_percentage && "border-destructive focus-visible:ring-destructive/40")}
              />
            </F>
            <F label="Minimum Guarantee (₹ / mo)" error={errors.minimum_guarantee_inr?.message}>
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register("minimum_guarantee_inr", { valueAsNumber: true })}
                placeholder="e.g. 8000"
              />
            </F>
            <F label="Payment Day of Month" error={errors.payment_day_of_month?.message}>
              <Input
                type="number"
                min={1}
                max={28}
                {...register("payment_day_of_month", { valueAsNumber: true })}
                placeholder="e.g. 5"
              />
            </F>
          </div>
        )}

        {/* Escalation — for all models */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
          <F label="Escalation %" error={errors.escalation_percentage?.message}>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              {...register("escalation_percentage", { valueAsNumber: true })}
              placeholder="e.g. 10"
            />
          </F>
          <F label="Escalation Every (months)" error={errors.escalation_frequency_months?.message}>
            <Input
              type="number"
              min={1}
              {...register("escalation_frequency_months", { valueAsNumber: true })}
              placeholder="e.g. 12"
            />
          </F>
        </div>
      </section>

      {/* Term */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Contract Term</h2>
        <div className="grid grid-cols-2 gap-4">
          <F label="Start Date" error={errors.start_date?.message} required>
            <Input
              type="date"
              {...register("start_date")}
              className={cn(errors.start_date && "border-destructive focus-visible:ring-destructive/40")}
            />
          </F>
          <F label="End Date" error={errors.end_date?.message}>
            <Input type="date" {...register("end_date")} />
          </F>
          <F label="Renewal Date" error={errors.renewal_date?.message}>
            <Input type="date" {...register("renewal_date")} />
          </F>
          <F label="Notice Period (days)" error={errors.notice_period_days?.message}>
            <Input
              type="number"
              min={0}
              {...register("notice_period_days", { valueAsNumber: true })}
              placeholder="90"
            />
          </F>
          <F label="Lock-in Period (months)" error={errors.lock_period_months?.message}>
            <Input
              type="number"
              min={0}
              {...register("lock_period_months", { valueAsNumber: true })}
              placeholder="e.g. 12"
            />
          </F>
        </div>
        <F label="Early Termination Clause" error={errors.early_termination_clause?.message}>
          <Textarea
            {...register("early_termination_clause")}
            placeholder="Describe any early termination conditions…"
            rows={2}
          />
        </F>
      </section>

      {/* Notes */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Notes</h2>
        <Textarea {...register("notes")} placeholder="Any additional terms or notes…" rows={3} />
      </section>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {existing ? "Save Changes" : "Create Contract"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
