"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { agencySchema, agencyDefaults, type AgencyFormValues } from "@/lib/validations/agency";
import { createAgency, updateAgency } from "@/app/[locale]/(dashboard)/agencies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { IndianStateSelect } from "@/components/shared/IndianStateSelect";
import type { PartnerAgency } from "@/lib/types/database";

interface Props { existing?: PartnerAgency }

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

export function AgencyForm({ existing }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaults: AgencyFormValues = existing ? {
    agency_name: existing.agency_name,
    contact_person: existing.contact_person ?? "",
    phone: existing.phone ?? "",
    email: existing.email ?? "",
    gstin: existing.gstin ?? "",
    address: existing.address ?? "",
    city: existing.city ?? "",
    state: existing.state ?? "",
    notes: existing.notes ?? "",
  } : agencyDefaults;

  const { register, handleSubmit, formState: { errors } } = useForm<AgencyFormValues>({
    resolver: zodResolver(agencySchema),
    defaultValues: defaults,
  });

  function onSubmit(values: AgencyFormValues) {
    startTransition(async () => {
      const result = existing
        ? await updateAgency(existing.id, values)
        : await createAgency(values);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success(existing ? "Agency updated" : "Agency created");
      router.push(`/agencies/${result.id}`);
    });
  }

  const inp = (field: keyof AgencyFormValues) =>
    cn(errors[field] && "border-destructive focus-visible:ring-destructive/40");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">

      {/* Agency info */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Agency Details</h2>
        <F label="Agency Name" error={errors.agency_name?.message} required>
          <Input
            {...register("agency_name")}
            placeholder="e.g. Sunrise Media Pvt Ltd"
            className={inp("agency_name")}
          />
        </F>
        <F label="Contact Person" error={errors.contact_person?.message}>
          <Input {...register("contact_person")} placeholder="Primary contact name" />
        </F>
        <div className="grid grid-cols-2 gap-4">
          <F label="Phone" error={errors.phone?.message}>
            <Input {...register("phone")} placeholder="9876543210" />
          </F>
          <F label="Email" error={errors.email?.message}>
            <Input {...register("email")} type="email" placeholder="contact@agency.com" />
          </F>
        </div>
        <F label="GSTIN" error={errors.gstin?.message}>
          <Input {...register("gstin")} placeholder="e.g. 27AABCS1429B1ZB" className="uppercase" />
        </F>
      </section>

      {/* Address */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">Address</h2>
        <F label="Street Address" error={errors.address?.message}>
          <Input {...register("address")} placeholder="e.g. 5th Floor, Infinity Towers" />
        </F>
        <div className="grid grid-cols-2 gap-4">
          <F label="City" error={errors.city?.message}>
            <Input {...register("city")} placeholder="Mumbai" />
          </F>
          <F label="State" error={errors.state?.message}>
            <IndianStateSelect {...register("state")} error={!!errors.state} />
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
          {existing ? "Save Changes" : "Create Agency"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
