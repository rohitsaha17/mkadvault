"use client";
// Dialog for uploading a standalone signed agreement — one that isn't tied
// to a full contract record. Useful for MoUs, NDAs, older paper contracts,
// and miscellaneous signed documents we still want to keep centrally.
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createSignedAgreement } from "@/app/[locale]/(dashboard)/contracts/actions";
import type { Landowner, PartnerAgency, Client, Site } from "@/lib/types/database";

interface Props {
  landowners: Pick<Landowner, "id" | "full_name">[];
  agencies: Pick<PartnerAgency, "id" | "agency_name">[];
  clients: Pick<Client, "id" | "company_name">[];
  sites: Pick<Site, "id" | "name" | "site_code">[];
}

export function SignedAgreementUploadDialog({
  landowners,
  agencies,
  clients,
  sites,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [counterpartyType, setCounterpartyType] = useState<string>("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    if (!file || file.size === 0) {
      toast.error("Please attach the signed PDF or image");
      return;
    }

    startTransition(async () => {
      const res = await createSignedAgreement(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Signed agreement uploaded");
      setOpen(false);
      setCounterpartyType("");
      formRef.current?.reset();
    });
  }

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Upload signed agreement
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                Upload signed agreement
              </h2>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form
              ref={formRef}
              onSubmit={handleSubmit}
              className="space-y-4 p-5 text-sm"
            >
              <Field label="Title" required>
                <Input
                  name="title"
                  required
                  placeholder="e.g. NDA with Acme Media, Apr 2026"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Counterparty type">
                  <select
                    name="counterparty_type"
                    value={counterpartyType}
                    onChange={(e) => setCounterpartyType(e.target.value)}
                    className={cn(
                      "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                    )}
                  >
                    <option value="">—</option>
                    <option value="landowner">Landowner</option>
                    <option value="agency">Agency</option>
                    <option value="client">Client</option>
                    <option value="other">Other</option>
                  </select>
                </Field>

                <Field label="Agreement date">
                  <Input type="date" name="agreement_date" />
                </Field>
              </div>

              {counterpartyType === "landowner" && (
                <Field label="Landowner">
                  <PartySelect name="landowner_id" options={landowners.map((l) => ({ id: l.id, label: l.full_name }))} />
                </Field>
              )}
              {counterpartyType === "agency" && (
                <Field label="Agency">
                  <PartySelect name="agency_id" options={agencies.map((a) => ({ id: a.id, label: a.agency_name }))} />
                </Field>
              )}
              {counterpartyType === "client" && (
                <Field label="Client">
                  <PartySelect name="client_id" options={clients.map((c) => ({ id: c.id, label: c.company_name }))} />
                </Field>
              )}

              <Field label="Related site (optional)">
                <PartySelect
                  name="site_id"
                  options={sites.map((s) => ({
                    id: s.id,
                    label: `${s.name}${s.site_code ? ` (${s.site_code})` : ""}`,
                  }))}
                />
              </Field>

              <Field label="Signed file (PDF / image)" required>
                <Input
                  type="file"
                  name="file"
                  required
                  accept=".pdf,.png,.jpg,.jpeg"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Max 10 MB.
                </p>
              </Field>

              <Field label="Notes">
                <Textarea name="notes" rows={2} placeholder="Optional notes…" />
              </Field>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button type="submit" disabled={isPending} className="gap-1.5">
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Upload
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function PartySelect({
  name,
  options,
}: {
  name: string;
  options: { id: string; label: string }[];
}) {
  return (
    <select
      name={name}
      className={cn(
        "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
      )}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
