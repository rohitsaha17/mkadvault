"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { landownerSchema, landownerDefaults, type LandownerFormValues } from "@/lib/validations/landowner";
import { createLandowner, updateLandowner } from "@/app/[locale]/(dashboard)/landowners/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Landowner } from "@/lib/types/database";

interface Props { existing?: Landowner }

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

export function LandownerForm({ existing }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaults: LandownerFormValues = existing ? {
    full_name: existing.full_name,
    phone: existing.phone ?? "",
    phone_alt: existing.phone_alt ?? "",
    email: existing.email ?? "",
    address: existing.address ?? "",
    city: existing.city ?? "",
    state: existing.state ?? "",
    pin_code: existing.pin_code ?? "",
    pan_number: existing.pan_number ?? "",
    aadhaar_reference: existing.aadhaar_reference ?? "",
    bank_name: existing.bank_name ?? "",
    bank_account_number: existing.bank_account_number ?? "",
    bank_ifsc: existing.bank_ifsc ?? "",
    notes: existing.notes ?? "",
  } : landownerDefaults;

  const { register, handleSubmit, formState: { errors } } = useForm<LandownerFormValues>({
    resolver: zodResolver(landownerSchema),
    defaultValues: defaults,
  });

  function onSubmit(values: LandownerFormValues) {
    startTransition(async () => {
      const result = existing
        ? await updateLandowner(existing.id, values)
        : await createLandowner(values);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success(existing ? "Landowner updated" : "Landowner created");
      router.push(`/landowners/${result.id}`);
    });
  }

  const inp = (field: keyof LandownerFormValues) =>
    cn(errors[field] && "border-destructive focus-visible:ring-destructive/40");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">

      {/* Personal */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Personal Information</h2>
        <F label="Full Name" error={errors.full_name?.message} required>
          <Input {...register("full_name")} placeholder="e.g. Ramesh Kumar" className={inp("full_name")} />
        </F>
        <div className="grid grid-cols-2 gap-4">
          <F label="Primary Phone" error={errors.phone?.message}>
            <Input {...register("phone")} placeholder="9876543210" />
          </F>
          <F label="Alternate Phone" error={errors.phone_alt?.message}>
            <Input {...register("phone_alt")} placeholder="Optional" />
          </F>
        </div>
        <F label="Email" error={errors.email?.message}>
          <Input {...register("email")} type="email" placeholder="ramesh@example.com" />
        </F>
      </section>

      {/* Address */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Address</h2>
        <F label="Street Address" error={errors.address?.message}>
          <Input {...register("address")} placeholder="e.g. 12, MG Road" />
        </F>
        <div className="grid grid-cols-3 gap-4">
          <F label="City" error={errors.city?.message}>
            <Input {...register("city")} placeholder="Mumbai" />
          </F>
          <F label="State" error={errors.state?.message}>
            <Input {...register("state")} placeholder="Maharashtra" />
          </F>
          <F label="Pin Code" error={errors.pin_code?.message}>
            <Input {...register("pin_code")} placeholder="400001" />
          </F>
        </div>
      </section>

      {/* Bank details */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground">Bank Details</h2>
          <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-full px-2 py-0.5">
            Sensitive — visible to authorised roles only
          </span>
        </div>
        <F label="Bank Name" error={errors.bank_name?.message}>
          <Input {...register("bank_name")} placeholder="e.g. State Bank of India" />
        </F>
        <div className="grid grid-cols-2 gap-4">
          <F label="Account Number" error={errors.bank_account_number?.message}>
            <Input {...register("bank_account_number")} placeholder="Account number" />
          </F>
          <F label="IFSC Code" error={errors.bank_ifsc?.message}>
            <Input {...register("bank_ifsc")} placeholder="e.g. SBIN0001234" />
          </F>
        </div>
      </section>

      {/* Tax */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Tax Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <F label="PAN Number" error={errors.pan_number?.message}>
            <Input {...register("pan_number")} placeholder="ABCDE1234F" className="uppercase" />
          </F>
          <F label="Aadhaar Reference" error={errors.aadhaar_reference?.message}>
            <Input {...register("aadhaar_reference")} placeholder="Last 4 digits only" />
          </F>
        </div>
      </section>

      {/* Notes */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Notes</h2>
        <Textarea {...register("notes")} placeholder="Any additional information…" rows={3} />
      </section>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {existing ? "Save Changes" : "Create Landowner"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
