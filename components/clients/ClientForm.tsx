"use client";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { clientSchema, clientDefaults, type ClientFormValues } from "@/lib/validations/client";
import { createClientRecord, updateClientRecord } from "@/app/[locale]/(dashboard)/clients/actions";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { IndianStateSelect } from "@/components/shared/IndianStateSelect";
import type { Client } from "@/lib/types/database";

interface Props { existing?: Client }

const TABS = [
  { key: "company", label: "Company Info" },
  { key: "contacts", label: "Contacts" },
  { key: "billing", label: "Billing Details" },
  { key: "notes", label: "Notes" },
] as const;
type TabKey = typeof TABS[number]["key"];

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

export function ClientForm({ existing }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<TabKey>("company");

  const defaults: ClientFormValues = existing ? {
    company_name: existing.company_name,
    brand_name: existing.brand_name ?? "",
    industry_category: existing.industry_category ?? "",
    primary_contact_name: existing.primary_contact_name ?? "",
    primary_contact_phone: existing.primary_contact_phone ?? "",
    primary_contact_email: existing.primary_contact_email ?? "",
    secondary_contact_name: existing.secondary_contact_name ?? "",
    secondary_contact_phone: existing.secondary_contact_phone ?? "",
    secondary_contact_email: existing.secondary_contact_email ?? "",
    billing_contact_name: existing.billing_contact_name ?? "",
    billing_contact_phone: existing.billing_contact_phone ?? "",
    billing_contact_email: existing.billing_contact_email ?? "",
    gstin: existing.gstin ?? "",
    pan: existing.pan ?? "",
    billing_address: existing.billing_address ?? "",
    billing_city: existing.billing_city ?? "",
    billing_state: existing.billing_state ?? "",
    billing_pin_code: existing.billing_pin_code ?? "",
    credit_terms: existing.credit_terms,
    notes: existing.notes ?? "",
  } : clientDefaults;

  const { register, handleSubmit, formState: { errors } } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: defaults,
  });

  function onSubmit(values: ClientFormValues) {
    const clean = sanitizeForTransport(values);
    startTransition(async () => {
      try {
        const result = existing
          ? await updateClientRecord(existing.id, clean)
          : await createClientRecord(clean);
        if ("error" in result) { toast.error(result.error); return; }
        toast.success(existing ? "Client updated" : "Client created");
        router.push(`/clients/${result.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">
      <section className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Company Info */}
      {activeTab === "company" && (
        <div className="space-y-4">
          <F label="Company Name" error={errors.company_name?.message} required>
            <Input
              {...register("company_name")}
              placeholder="e.g. Hindustan Unilever Ltd"
              className={cn(errors.company_name && "border-destructive focus-visible:ring-destructive/40")}
            />
          </F>
          <div className="grid grid-cols-2 gap-4">
            <F label="Brand Name" error={errors.brand_name?.message}>
              <Input {...register("brand_name")} placeholder="e.g. Dove" />
            </F>
            <F label="Industry Category" error={errors.industry_category?.message}>
              <Input {...register("industry_category")} placeholder="e.g. FMCG, Telecom" />
            </F>
          </div>
          <F label="Credit Terms" error={errors.credit_terms?.message} required>
            <NativeSelect {...register("credit_terms")}>
              <option value="advance">Advance</option>
              <option value="net15">Net 15</option>
              <option value="net30">Net 30</option>
              <option value="net60">Net 60</option>
            </NativeSelect>
          </F>
        </div>
      )}

      {/* Contacts */}
      {activeTab === "contacts" && (
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Primary Contact</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Name" error={errors.primary_contact_name?.message}>
                <Input {...register("primary_contact_name")} placeholder="Contact person name" />
              </F>
              <F label="Phone" error={errors.primary_contact_phone?.message}>
                <Input {...register("primary_contact_phone")} placeholder="9876543210" />
              </F>
            </div>
            <F label="Email" error={errors.primary_contact_email?.message}>
              <Input {...register("primary_contact_email")} type="email" placeholder="contact@brand.com" />
            </F>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Secondary Contact</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Name" error={errors.secondary_contact_name?.message}>
                <Input {...register("secondary_contact_name")} placeholder="Alternate contact" />
              </F>
              <F label="Phone" error={errors.secondary_contact_phone?.message}>
                <Input {...register("secondary_contact_phone")} placeholder="Optional" />
              </F>
            </div>
            <F label="Email" error={errors.secondary_contact_email?.message}>
              <Input {...register("secondary_contact_email")} type="email" placeholder="Optional" />
            </F>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">Billing Contact</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Name" error={errors.billing_contact_name?.message}>
                <Input {...register("billing_contact_name")} placeholder="Finance dept contact" />
              </F>
              <F label="Phone" error={errors.billing_contact_phone?.message}>
                <Input {...register("billing_contact_phone")} placeholder="Optional" />
              </F>
            </div>
            <F label="Email" error={errors.billing_contact_email?.message}>
              <Input {...register("billing_contact_email")} type="email" placeholder="accounts@brand.com" />
            </F>
          </section>
        </div>
      )}

      {/* Billing Details */}
      {activeTab === "billing" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <F label="GSTIN" error={errors.gstin?.message}>
              <Input {...register("gstin")} placeholder="e.g. 27AABCU9603R1ZX" className="uppercase" />
            </F>
            <F label="PAN" error={errors.pan?.message}>
              <Input {...register("pan")} placeholder="e.g. AABCU9603R" className="uppercase" />
            </F>
          </div>
          <F label="Billing Address" error={errors.billing_address?.message}>
            <Input {...register("billing_address")} placeholder="Street address for invoices" />
          </F>
          <div className="grid grid-cols-3 gap-4">
            <F label="City" error={errors.billing_city?.message}>
              <Input {...register("billing_city")} placeholder="Mumbai" />
            </F>
            <F label="State" error={errors.billing_state?.message}>
              <IndianStateSelect
                {...register("billing_state")}
                error={!!errors.billing_state}
              />
            </F>
            <F label="Pin Code" error={errors.billing_pin_code?.message}>
              <Input {...register("billing_pin_code")} placeholder="400001" />
            </F>
          </div>
        </div>
      )}

      {/* Notes */}
      {activeTab === "notes" && (
        <div className="space-y-4">
          <F label="Notes" error={errors.notes?.message}>
            <Textarea
              {...register("notes")}
              placeholder="Internal notes about this client…"
              rows={5}
            />
          </F>
        </div>
      )}

      </section>

      {/* Footer */}
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {existing ? "Save Changes" : "Create Client"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
