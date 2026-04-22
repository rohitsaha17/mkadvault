"use client";
// Dialog for creating a new payment request (site expense).
// Any user in the org can create one — finance team later approves / marks paid.
//
// File upload flow: client reads the file as base64 → sends bytes to the
// `uploadExpenseDoc` server action → gets back a storage path which we store
// in `receipt_doc_urls`. This mirrors the pattern used by other upload dialogs.

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, X, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createExpense,
  uploadExpenseDoc,
} from "@/app/[locale]/(dashboard)/expenses/actions";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYEE_TYPES,
} from "@/lib/constants/expenses";
import type {
  ExpenseCategory,
  ExpensePayeeType,
} from "@/lib/types/database";

interface Props {
  // When opened from a site page we pre-select the site so the user can't
  // pick the wrong one. When opened from /expenses it's free-form.
  sites?: { id: string; name: string; site_code: string | null }[];
  defaultSiteId?: string;
  // Nudge to refresh when the create succeeds. Parent usually calls
  // router.refresh() here.
  onCreated?: () => void;
  // Optional trigger override; default is a primary "New request" button.
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
  triggerSize?: "sm" | "default";
}

interface UploadedDoc {
  path: string;
  name: string;
}

// Read file as base64 (no data: prefix).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:<mime>;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function NewExpenseDialog({
  sites = [],
  defaultSiteId,
  onCreated,
  triggerLabel = "New request",
  triggerVariant = "default",
  triggerSize = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetAll() {
    setDocs([]);
    formRef.current?.reset();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10 MB)");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const b64 = await fileToBase64(file);
      const res = await uploadExpenseDoc(file.name, b64, "inbox", "receipt");
      if (res.error || !res.path) {
        toast.error(res.error ?? "Upload failed");
        return;
      }
      setDocs((prev) => [...prev, { path: res.path!, name: file.name }]);
      toast.success(`Attached ${file.name}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeDoc(idx: number) {
    setDocs((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amountRupees = parseFloat(String(fd.get("amount_rupees") ?? ""));
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    const values = {
      site_id: (fd.get("site_id") as string) || null,
      category: fd.get("category") as ExpenseCategory,
      description: String(fd.get("description") ?? "").trim(),
      amount_rupees: amountRupees,
      payee_type: fd.get("payee_type") as ExpensePayeeType,
      payee_name: String(fd.get("payee_name") ?? "").trim(),
      payee_contact: (fd.get("payee_contact") as string) || undefined,
      payee_bank_details: {
        bank: (fd.get("bank") as string) || undefined,
        account_number: (fd.get("account_number") as string) || undefined,
        ifsc: (fd.get("ifsc") as string) || undefined,
        upi: (fd.get("upi") as string) || undefined,
      },
      needed_by: (fd.get("needed_by") as string) || null,
      notes: (fd.get("notes") as string) || null,
      receipt_doc_urls: docs.map((d) => d.path),
    };

    startTransition(async () => {
      const res = await createExpense(values);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Payment request created");
      setOpen(false);
      resetAll();
      onCreated?.();
    });
  }

  return (
    <>
      <Button
        size={triggerSize}
        variant={triggerVariant}
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4" />
        {triggerLabel}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 sticky top-0 bg-card z-10">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  New payment request
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ask accounts to pay for a site expense (electricity, rent,
                  cleaning, etc.)
                </p>
              </div>
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
              <div className="grid grid-cols-2 gap-3">
                <Field label="Site" hint="Optional — leave blank for overhead">
                  <PartySelect
                    name="site_id"
                    defaultValue={defaultSiteId ?? ""}
                    options={sites.map((s) => ({
                      id: s.id,
                      label: s.site_code ? `${s.name} (${s.site_code})` : s.name,
                    }))}
                  />
                </Field>

                <Field label="Category" required>
                  <select
                    name="category"
                    required
                    defaultValue="electricity"
                    className={selectClass}
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Description" required>
                <Input
                  name="description"
                  required
                  maxLength={500}
                  placeholder="e.g. DISCOM bill for April 2026"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)" required>
                  <Input
                    name="amount_rupees"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Needed by">
                  <Input type="date" name="needed_by" />
                </Field>
              </div>

              <div className="pt-2 border-t border-border/60">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payee
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Payee type" required>
                    <select
                      name="payee_type"
                      required
                      defaultValue="vendor"
                      className={selectClass}
                    >
                      {EXPENSE_PAYEE_TYPES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Payee name" required>
                    <Input
                      name="payee_name"
                      required
                      maxLength={200}
                      placeholder="e.g. Rajesh Electrician"
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Phone / contact">
                    <Input
                      name="payee_contact"
                      maxLength={200}
                      placeholder="Phone / email"
                    />
                  </Field>
                </div>
                <details className="mt-3 rounded-lg border border-border/60 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Bank / UPI details (optional)
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Bank name">
                      <Input name="bank" maxLength={100} />
                    </Field>
                    <Field label="IFSC">
                      <Input name="ifsc" maxLength={20} />
                    </Field>
                    <Field label="Account number">
                      <Input name="account_number" maxLength={40} />
                    </Field>
                    <Field label="UPI ID">
                      <Input name="upi" maxLength={80} placeholder="name@bank" />
                    </Field>
                  </div>
                </details>
              </div>

              <div className="pt-2 border-t border-border/60">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Supporting documents
                </h3>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
                  onChange={handleFileSelected}
                  disabled={uploading}
                  className={cn(
                    "block w-full text-sm text-muted-foreground",
                    "file:mr-3 file:rounded-md file:border-0 file:bg-muted",
                    "file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground",
                    "hover:file:bg-muted/80 disabled:opacity-60",
                  )}
                />
                {uploading && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading…
                  </p>
                )}
                {docs.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {docs.map((d, idx) => (
                      <li
                        key={d.path}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs"
                      >
                        <span className="truncate font-medium text-foreground">
                          {d.name}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          aria-label="Remove"
                          onClick={() => removeDoc(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Max 10 MB per file. Supported: PDF, JPG, PNG, WEBP, HEIC.
                </p>
              </div>

              <Field label="Notes">
                <Textarea
                  name="notes"
                  rows={2}
                  maxLength={2000}
                  placeholder="Optional notes for accounts…"
                />
              </Field>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  type="submit"
                  disabled={isPending || uploading}
                  className="gap-1.5"
                >
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create request
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    resetAll();
                  }}
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

const selectClass = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
);

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
        {hint && (
          <span className="ml-2 font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

function PartySelect({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: { id: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className={selectClass}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
