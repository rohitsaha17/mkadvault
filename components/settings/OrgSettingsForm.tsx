"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callAction } from "@/lib/utils/call-action";
import { orgSettingsSchema, type OrgSettingsFormValues } from "@/lib/validations/settings";
import { IndianStateSelect } from "@/components/shared/IndianStateSelect";
import { BankAccountsManager } from "@/components/settings/BankAccountsManager";
import type { Organization, OrganizationBankAccount } from "@/lib/types/database";

interface Props {
  org: Organization;
  // Signed URL for the current logo (1-hour TTL) generated server-side.
  // Null when no logo has been uploaded yet.
  orgLogoSignedUrl?: string | null;
  // Bank accounts used on invoices — managed inline, one-shot saves
  // independent of the main form submit.
  bankAccounts?: OrganizationBankAccount[];
}

export function OrgSettingsForm({ org, orgLogoSignedUrl, bankAccounts = [] }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  // Show the newly-uploaded logo immediately without waiting for a
  // full server-component refresh; fall back to the signed URL the
  // parent page passed in.
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(
    orgLogoSignedUrl ?? null,
  );

  async function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be retried on error.
    if (fileInputRef.current) fileInputRef.current.value = "";

    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/org/logo", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.signedUrl) setLogoPreviewUrl(data.signedUrl);
      toast.success("Logo updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLogoDelete() {
    if (!confirm("Remove the organisation logo?")) return;
    setUploadingLogo(true);
    try {
      const res = await fetch("/api/org/logo", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      setLogoPreviewUrl(null);
      toast.success("Logo removed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setUploadingLogo(false);
    }
  }

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
      try {
        const res = await callAction<{ error?: string }>("updateOrganization", values);
        if (res.error) toast.error(res.error);
        else toast.success("Organisation updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* ── Logo upload ──────────────────────────────────────────────── */}
      {/* Separate from the rest of the form because it saves as soon as
          you pick a file (one-shot upload) rather than waiting for the
          "Save Organisation" button. */}
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
            {logoPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL with query string, not optimisable
              <img
                src={logoPreviewUrl}
                alt="Organisation logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <Building2 className="h-8 w-8 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Organisation logo</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Used on proposal / rate-card slides + exports. PNG, JPG, WEBP or SVG,
              up to 2 MB. Transparent background works best for slide branding.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                onChange={handleLogoFileChange}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingLogo}
                className="gap-1.5"
              >
                {uploadingLogo ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {logoPreviewUrl ? "Replace logo" : "Upload logo"}
              </Button>
              {logoPreviewUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleLogoDelete}
                  disabled={uploadingLogo}
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

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

      {/* ── Bank accounts (independent of the main form save) ────────── */}
      <div className="mt-6 border-t border-border pt-6">
        <BankAccountsManager accounts={bankAccounts} />
      </div>
    </form>
  );
}
