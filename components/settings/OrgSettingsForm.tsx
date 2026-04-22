"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrganization } from "@/app/[locale]/(dashboard)/settings/actions";
import { orgSettingsSchema, type OrgSettingsFormValues } from "@/lib/validations/settings";
import { IndianStateSelect } from "@/components/shared/IndianStateSelect";
import type { Organization } from "@/lib/types/database";

interface Props {
  org: Organization;
}

export function OrgSettingsForm({ org }: Props) {
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrgSettingsFormValues>({
    resolver: zodResolver(orgSettingsSchema),
    defaultValues: {
      name: org.name ?? "",
      address: org.address ?? "",
      city: org.city ?? "",
      state: org.state ?? "",
      pin_code: org.pin_code ?? "",
      phone: org.phone ?? "",
      email: org.email ?? "",
      gstin: org.gstin ?? "",
      pan: org.pan ?? "",
      proposal_terms_template: org.proposal_terms_template ?? "",
    },
  });

  function onSubmit(values: OrgSettingsFormValues) {
    startTransition(async () => {
      const res = await updateOrganization(values);
      if (res.error) toast.error(res.error);
      else toast.success("Organisation updated");
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="orgName">Organisation Name</Label>
          <Input id="orgName" {...register("name")} placeholder="Your company name" />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" {...register("address")} placeholder="Street address" />
          {errors.address && (
            <p className="text-xs text-destructive">{errors.address.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" {...register("city")} placeholder="Mumbai" />
          {errors.city && (
            <p className="text-xs text-destructive">{errors.city.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="state">State</Label>
          <IndianStateSelect id="state" {...register("state")} error={!!errors.state} />
          {errors.state && (
            <p className="text-xs text-destructive">{errors.state.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pin_code">Pin Code</Label>
          <Input id="pin_code" {...register("pin_code")} placeholder="400001" />
          {errors.pin_code && (
            <p className="text-xs text-destructive">{errors.pin_code.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="orgPhone">Phone</Label>
          <Input id="orgPhone" {...register("phone")} placeholder="+91 22 1234 5678" />
          {errors.phone && (
            <p className="text-xs text-destructive">{errors.phone.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="orgEmail">Email</Label>
          <Input id="orgEmail" type="email" {...register("email")} placeholder="info@yourcompany.com" />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gstin">GSTIN</Label>
          <Input id="gstin" {...register("gstin")} placeholder="27AABCU9603R1ZX" />
          {errors.gstin && (
            <p className="text-xs text-destructive">{errors.gstin.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pan">PAN</Label>
          <Input id="pan" {...register("pan")} placeholder="AABCU9603R" />
          {errors.pan && (
            <p className="text-xs text-destructive">{errors.pan.message}</p>
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="proposal_terms_template">
            Proposal / Rate-card Terms & Conditions
          </Label>
          <textarea
            id="proposal_terms_template"
            {...register("proposal_terms_template")}
            rows={6}
            placeholder="Payment terms, cancellation policy, creative approval process, etc. This text pre-fills the T&C section on every new proposal and rate card — editable per proposal."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to skip T&C by default. Users can still enter one-off terms per proposal.
          </p>
          {errors.proposal_terms_template && (
            <p className="text-xs text-destructive">
              {errors.proposal_terms_template.message}
            </p>
          )}
        </div>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save Organisation
      </Button>
    </form>
  );
}
