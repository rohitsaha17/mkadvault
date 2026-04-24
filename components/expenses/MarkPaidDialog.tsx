"use client";
// Finance-team dialog: mark a pending / approved expense as paid.
// Captures payment settlement fields and lets accounts upload one or more
// proof documents (bank screenshot, cheque image, UPI receipt).
//
// Guarded in the UI by role check at the parent level, but the server action
// re-checks. Don't rely on client-side gating for correctness.

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";
import { PAYMENT_MODES } from "@/lib/constants/expenses";
import type { PaymentMode } from "@/lib/types/database";

interface Props {
  expenseId: string;
  amountPaise: number;
  payeeName: string;
  onSuccess?: () => void;
  triggerLabel?: string;
  triggerSize?: "sm" | "default";
}

interface UploadedDoc {
  path: string;
  name: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function MarkPaidDialog({
  expenseId,
  amountPaise,
  payeeName,
  onSuccess,
  triggerLabel = "Mark paid",
  triggerSize = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [proofs, setProofs] = useState<UploadedDoc[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const res = await callAction<{ error?: string; path?: string }>(
        "uploadExpenseDoc",
        file.name,
        b64,
        expenseId,
        "proof",
      );
      if (res.error || !res.path) {
        toast.error(res.error ?? "Upload failed");
        return;
      }
      setProofs((prev) => [...prev, { path: res.path!, name: file.name }]);
      toast.success(`Attached ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeDoc(idx: number) {
    setProofs((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const paid_at = String(fd.get("paid_at") ?? "").trim();
    const payment_mode = fd.get("payment_mode") as PaymentMode;
    const payment_reference =
      (fd.get("payment_reference") as string)?.trim() || undefined;
    const tdsRaw = String(fd.get("tds_rupees") ?? "").trim();
    const tds_rupees = tdsRaw === "" ? null : parseFloat(tdsRaw);
    const notes = (fd.get("notes") as string)?.trim() || undefined;

    if (!paid_at) {
      toast.error("Pick a payment date");
      return;
    }
    if (tds_rupees !== null && !Number.isFinite(tds_rupees)) {
      toast.error("TDS must be a number");
      return;
    }

    startTransition(async () => {
      try {
        const res = await callAction<{ error?: string }>("markExpensePaid", {
          expense_id: expenseId,
          paid_at,
          payment_mode,
          payment_reference,
          tds_rupees,
          payment_proof_urls: proofs.map((p) => p.path),
          notes,
        });
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success("Marked paid");
        setOpen(false);
        setProofs([]);
        formRef.current?.reset();
        onSuccess?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <>
      <Button
        size={triggerSize}
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 sticky top-0 bg-card z-10">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Mark as paid
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {inr(amountPaise)} · {payeeName}
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
                <Field label="Payment date" required>
                  <Input
                    type="date"
                    name="paid_at"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <Field label="Payment mode" required>
                  <select
                    name="payment_mode"
                    required
                    defaultValue="bank_transfer"
                    className={selectClass}
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Reference / UTR">
                  <Input
                    name="payment_reference"
                    maxLength={200}
                    placeholder="UTR / cheque / ref #"
                  />
                </Field>
                <Field label="TDS (₹)">
                  <Input
                    type="number"
                    name="tds_rupees"
                    step="0.01"
                    min="0"
                    placeholder="0"
                  />
                </Field>
              </div>

              <div className="pt-2 border-t border-border/60">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment proof
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
                {proofs.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {proofs.map((d, idx) => (
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
                  Attach the bank screenshot, receipt, or cheque copy.
                </p>
              </div>

              <Field label="Notes">
                <Textarea
                  name="notes"
                  rows={2}
                  maxLength={2000}
                  placeholder="Any follow-up note (optional)…"
                />
              </Field>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  type="submit"
                  disabled={isPending || uploading}
                  className="gap-1.5"
                >
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm paid
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

const selectClass = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
);

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
