"use client";
// Dialog for creating a new payment request (site expense).
// Any user in the org can create one — finance team later approves / marks paid.
//
// File upload flow: client reads the file as base64 → sends bytes to the
// `uploadExpenseDoc` server action → gets back a storage path which we store
// in `receipt_doc_urls`. This mirrors the pattern used by other upload dialogs.

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, X, Upload, Trash2, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYEE_TYPES,
} from "@/lib/constants/expenses";
import type {
  ExpenseCategory,
  ExpensePayeeType,
} from "@/lib/types/database";

// Categories that should be raised as a campaign job instead of a
// free-form payment request. Printing and mounting have dedicated
// job types (print / mount / print_and_mount) which auto-spawn a
// linked expense row — that path preserves the campaign link, the
// job status, and the vendor association. Raising them here loses
// all of that context.
const JOB_ONLY_CATEGORIES: ExpenseCategory[] = ["printing", "mounting"];

function jobCategoryLabel(category: ExpenseCategory): string {
  if (category === "printing") return "printing";
  if (category === "mounting") return "mounting";
  return category;
}

interface Props {
  // When opened from a site page we pre-select the site so the user can't
  // pick the wrong one. When opened from /expenses it's free-form.
  sites?: { id: string; name: string; site_code: string | null }[];
  defaultSiteId?: string;
  // Optional campaign picker — lets users tag a payment request to a
  // specific campaign (flex printing for Campaign A, mounting for
  // Campaign B, etc.). Leave empty to skip the field entirely.
  campaigns?: { id: string; campaign_name: string; campaign_code: string | null }[];
  defaultCampaignId?: string;
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
  campaigns = [],
  defaultCampaignId,
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
  // Track category in controlled state so the job-only guard (below)
  // can flip to a "raise a job instead" panel the moment the user
  // picks printing / mounting. FormData would only see the value on
  // submit, which is too late for UX.
  const [category, setCategory] = useState<ExpenseCategory>("electricity");
  const isJobOnly = JOB_ONLY_CATEGORIES.includes(category);

  // The modal markup is rendered via createPortal to document.body so
  // it escapes any parent that has `transform`, `overflow`, or `filter`
  // set — without the portal, `position: fixed` becomes relative to
  // the nearest such ancestor and the modal visibly scrolls with the
  // page. This was the bug on the site detail page where the card
  // container's transform was pulling the dialog along with the scroll.
  // Portal only exists on the client, so we gate on mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock the page's scroll while the modal is open so scroll events
  // target the dialog body rather than the underlying page.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
      // Routed through the /api/action dispatcher for stable URLs —
      // see lib/actions/registry.ts for the rationale.
      const res = await callAction<{ error?: string; path?: string }>(
        "uploadExpenseDoc",
        file.name,
        b64,
        "inbox",
        "receipt",
      );
      if (res.error || !res.path) {
        toast.error(res.error ?? "Upload failed");
        return;
      }
      setDocs((prev) => [...prev, { path: res.path!, name: file.name }]);
      toast.success(`Attached ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
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
    // Belt-and-braces: if for any reason the guard panel was bypassed
    // (e.g. dev tools removed the disabled attribute), refuse to
    // submit printing/mounting from this dialog.
    if (JOB_ONLY_CATEGORIES.includes(category)) {
      toast.error(
        `Raise a ${jobCategoryLabel(category)} job from the campaign instead.`,
      );
      return;
    }
    const fd = new FormData(e.currentTarget);
    const amountRupees = parseFloat(String(fd.get("amount_rupees") ?? ""));
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    const values = {
      site_id: (fd.get("site_id") as string) || null,
      campaign_id: (fd.get("campaign_id") as string) || null,
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
      try {
        const res = await callAction<{ error?: string; id?: string }>(
          "createExpense",
          values,
        );
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success("Payment request created");
        setOpen(false);
        resetAll();
        onCreated?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
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

      {open && mounted && createPortal(
        // Modal uses a flex column layout so header (shrink-0) + scrollable
        // body (flex-1 overflow-y-auto) + footer (shrink-0) stay visible at
        // once — the submit button never falls below the fold, which was the
        // original viewability complaint. Outer padding is smaller on mobile
        // so the card fills the screen properly on phones.
        //
        // Rendered via createPortal to document.body so `position: fixed`
        // is relative to the viewport regardless of parent transforms /
        // overflow. Without the portal the dialog visibly scrolls with
        // the page when a grandparent has `transform` — the bug the user
        // reported on the site detail page.
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl sm:max-h-[calc(100dvh-2rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — shrink-0 so it never scrolls away */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  New payment request
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ask finance to pay a site expense — electricity, rent,
                  cleaning, mounting, etc.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Form — flex-1 so body scrolls and footer stays pinned */}
            <form
              ref={formRef}
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col text-sm"
            >
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as ExpenseCategory)
                      }
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

                {/* ── Job-only guard ──────────────────────────────────
                    Printing and mounting have dedicated campaign-job
                    types that auto-spawn a linked payment request with
                    the right vendor, job status, and campaign link.
                    Raising one free-form here skips all that context,
                    so we redirect the user to the campaign's Jobs tab
                    instead of letting them submit. */}
                {isJobOnly && (
                  <div
                    role="alert"
                    className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <div className="flex gap-3">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <div className="space-y-2">
                        <p className="font-medium">
                          Raise a {jobCategoryLabel(category)} job from the
                          campaign instead
                        </p>
                        <p className="text-amber-900/90 dark:text-amber-200/90">
                          {jobCategoryLabel(category) === "printing"
                            ? "Printing expenses should be tied to a campaign job so we keep the vendor, quantity, and campaign link together. "
                            : "Mounting expenses should be tied to a campaign job so the crew, site list, and proof photos stay linked together. "}
                          Open the campaign, go to the <strong>Jobs</strong> tab,
                          and click <strong>Add Job</strong>. The payment
                          request will be generated automatically from the job.
                        </p>
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <Link
                            href="/campaigns"
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-white/60 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-white dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30"
                          >
                            Open campaigns
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setCategory("other")}
                            className="text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
                          >
                            Pick a different category
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Everything below the category is dimmed + made
                    non-interactive when a job-only category is chosen,
                    so the user can't fill in a form that won't submit. */}
                <fieldset
                  disabled={isJobOnly}
                  className={cn(
                    "space-y-4",
                    isJobOnly && "pointer-events-none opacity-50",
                  )}
                >
                {/* Optional campaign tag — visible only when the caller
                    actually passed in a campaigns list (e.g. from a page
                    that has that data on hand). Helps attribute this
                    expense to a specific campaign on the P&L. */}
                {campaigns.length > 0 && (
                  <Field
                    label="Campaign"
                    hint="Optional — tag this request to a campaign for P&L attribution"
                  >
                    <PartySelect
                      name="campaign_id"
                      defaultValue={defaultCampaignId ?? ""}
                      options={campaigns.map((c) => ({
                        id: c.id,
                        label: c.campaign_code
                          ? `${c.campaign_name} (${c.campaign_code})`
                          : c.campaign_name,
                      }))}
                    />
                  </Field>
                )}

                <Field label="Description" required>
                  <Input
                    name="description"
                    required
                    maxLength={500}
                    placeholder="e.g. DISCOM bill for April 2026"
                  />
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    Supporting receipts / bills
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
                </fieldset>
              </div>

              {/* Footer — pinned below the scrollable body so Create / Cancel
                  are always visible regardless of form length or screen size. */}
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
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
                <Button
                  type="submit"
                  disabled={isPending || uploading || isJobOnly}
                  className="gap-1.5"
                  title={
                    isJobOnly
                      ? `Raise a ${jobCategoryLabel(category)} job from the campaign instead`
                      : undefined
                  }
                >
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create request
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
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
