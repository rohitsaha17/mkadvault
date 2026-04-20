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
          <Input id="state" {...register("state")} placeholder="Maharashtra" />
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
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save Organisation
      </Button>
    </form>
  );
}
