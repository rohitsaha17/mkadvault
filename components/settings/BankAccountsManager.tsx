"use client";
// Inline CRUD for organisation bank accounts. Lives on the Settings >
// Organisation card. Each account can be printed on invoices — the
// user picks one per invoice in the InvoiceForm.
//
// Design choice: one-shot saves per-row (not wrapped in the larger
// "Save Organisation" form) because bank details are sensitive and
// the user may want to save/edit them independently of the logo or
// address fields.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  Check,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { OrganizationBankAccount } from "@/lib/types/database";

interface Props {
  accounts: OrganizationBankAccount[];
}

type Draft = {
  id?: string;
  label: string;
  bank_name: string;
  account_holder_name: string;
  account_number: string;
  ifsc_code: string;
  branch_name: string;
  account_type: "savings" | "current" | "other" | "";
  upi_id: string;
  is_primary: boolean;
};

function blankDraft(): Draft {
  return {
    label: "",
    bank_name: "",
    account_holder_name: "",
    account_number: "",
    ifsc_code: "",
    branch_name: "",
    account_type: "",
    upi_id: "",
    is_primary: false,
  };
}

function toDraft(a: OrganizationBankAccount): Draft {
  return {
    id: a.id,
    label: a.label ?? "",
    bank_name: a.bank_name,
    account_holder_name: a.account_holder_name ?? "",
    account_number: a.account_number,
    ifsc_code: a.ifsc_code,
    branch_name: a.branch_name ?? "",
    account_type: (a.account_type ?? "") as Draft["account_type"],
    upi_id: a.upi_id ?? "",
    is_primary: a.is_primary,
  };
}

// Mask all but the last 4 digits so over-the-shoulder peeks on the
// settings page don't leak the full number. The invoice PDF prints
// it in full.
function maskAccount(n: string) {
  if (n.length <= 4) return n;
  return "•".repeat(Math.max(4, n.length - 4)) + n.slice(-4);
}

export function BankAccountsManager({ accounts }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [isPending, startTransition] = useTransition();

  function startNew() {
    setDraft(blankDraft());
    setEditingId("new");
  }
  function startEdit(a: OrganizationBankAccount) {
    setDraft(toDraft(a));
    setEditingId(a.id);
  }
  function cancel() {
    setEditingId(null);
    setDraft(blankDraft());
  }

  async function save() {
    if (!draft.bank_name.trim() || !draft.account_number.trim() || !draft.ifsc_code.trim()) {
      toast.error("Bank name, account number and IFSC are required.");
      return;
    }
    const isUpdate = editingId !== "new" && !!editingId;
    const url = isUpdate
      ? `/api/org/bank-accounts?id=${encodeURIComponent(editingId)}`
      : "/api/org/bank-accounts";
    const method = isUpdate ? "PATCH" : "POST";

    startTransition(async () => {
      try {
        const res = await fetch(url, {
          method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: draft.label.trim() || null,
            bank_name: draft.bank_name.trim(),
            account_holder_name: draft.account_holder_name.trim() || null,
            account_number: draft.account_number.trim(),
            ifsc_code: draft.ifsc_code.trim().toUpperCase(),
            branch_name: draft.branch_name.trim() || null,
            account_type: draft.account_type || null,
            upi_id: draft.upi_id.trim() || null,
            is_primary: draft.is_primary,
          }),
        });
        const raw = await res.text();
        let data: { error?: string } = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (!res.ok || data.error) {
          toast.error(data.error ?? `Save failed (${res.status})`);
          return;
        }
        toast.success(isUpdate ? "Bank account updated" : "Bank account added");
        cancel();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  async function makePrimary(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/org/bank-accounts?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_primary: true }),
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}
      if (!res.ok || data.error) {
        toast.error(data.error ?? `Update failed (${res.status})`);
        return;
      }
      toast.success("Primary account updated");
      router.refresh();
    });
  }

  async function remove(id: string) {
    if (!confirm("Remove this bank account? Previously-issued invoices are not affected.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/org/bank-accounts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {}
      if (!res.ok || data.error) {
        toast.error(data.error ?? `Remove failed (${res.status})`);
        return;
      }
      toast.success("Bank account removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Bank accounts</p>
          <p className="text-xs text-muted-foreground">
            These appear on the invoice. Pick one per invoice. Mark one as primary to be selected by default.
          </p>
        </div>
        {editingId === null && (
          <Button type="button" size="sm" variant="outline" onClick={startNew} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add account
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {accounts.length === 0 && editingId !== "new" && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <Building2 className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">
              No bank accounts yet. Add one to include it on your invoices.
            </p>
          </div>
        )}

        {accounts.map((a) =>
          editingId === a.id ? (
            <AccountEditor
              key={a.id}
              draft={draft}
              setDraft={setDraft}
              onCancel={cancel}
              onSave={save}
              isPending={isPending}
            />
          ) : (
            <div
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {a.label || a.bank_name}
                  </p>
                  {a.is_primary && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
                      <Star className="h-3 w-3" aria-hidden />
                      Primary
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.bank_name}
                  {a.branch_name ? ` · ${a.branch_name}` : ""}
                </p>
                <p className="mt-1 font-mono text-xs text-foreground">
                  A/C {maskAccount(a.account_number)} · IFSC {a.ifsc_code}
                </p>
                {a.account_holder_name && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    A/C holder: {a.account_holder_name}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {!a.is_primary && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => makePrimary(a.id)}
                    disabled={isPending}
                    className="gap-1.5 text-xs"
                  >
                    <Star className="h-3.5 w-3.5" />
                    Make primary
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => startEdit(a)}
                  disabled={isPending}
                  className="gap-1.5 text-xs"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(a.id)}
                  disabled={isPending}
                  className="gap-1.5 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          ),
        )}

        {editingId === "new" && (
          <AccountEditor
            draft={draft}
            setDraft={setDraft}
            onCancel={cancel}
            onSave={save}
            isPending={isPending}
          />
        )}
      </div>
    </div>
  );
}

// ─── Editor row (inline form) ────────────────────────────────────────────────

function AccountEditor({
  draft,
  setDraft,
  onCancel,
  onSave,
  isPending,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
  isPending: boolean;
}) {
  function up<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft({ ...draft, [k]: v });
  }
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-muted/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Label (optional)</Label>
          <Input
            value={draft.label}
            onChange={(e) => up("label", e.target.value)}
            placeholder="e.g. HDFC Current — Main"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Account type</Label>
          <select
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
            value={draft.account_type}
            onChange={(e) => up("account_type", e.target.value as Draft["account_type"])}
          >
            <option value="">—</option>
            <option value="current">Current</option>
            <option value="savings">Savings</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Bank name *</Label>
          <Input
            value={draft.bank_name}
            onChange={(e) => up("bank_name", e.target.value)}
            placeholder="HDFC Bank"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Branch</Label>
          <Input
            value={draft.branch_name}
            onChange={(e) => up("branch_name", e.target.value)}
            placeholder="BKC, Mumbai"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Account number *</Label>
          <Input
            value={draft.account_number}
            onChange={(e) => up("account_number", e.target.value)}
            placeholder="50100123456789"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">IFSC *</Label>
          <Input
            value={draft.ifsc_code}
            onChange={(e) => up("ifsc_code", e.target.value.toUpperCase())}
            placeholder="HDFC0001234"
            className="font-mono uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Account holder name</Label>
          <Input
            value={draft.account_holder_name}
            onChange={(e) => up("account_holder_name", e.target.value)}
            placeholder="Legal name on the account"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">UPI ID (optional)</Label>
          <Input
            value={draft.upi_id}
            onChange={(e) => up("upi_id", e.target.value)}
            placeholder="yourbusiness@okhdfcbank"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={draft.is_primary}
          onChange={(e) => up("is_primary", e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        Make this the primary account (selected by default on new invoices)
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onSave} disabled={isPending} className="gap-1.5">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save account
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isPending} className="gap-1.5">
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
