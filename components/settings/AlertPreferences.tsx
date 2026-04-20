"use client";
// Alert Preferences panel inside the Settings page.
// Shows a row per alert type, with toggles for in_app / email / whatsapp
// and an editable advance_days list.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertAlertPreference } from "@/app/[locale]/(dashboard)/settings/actions";
import type { AlertPreference, AlertType } from "@/lib/types/database";

// ─── Config ───────────────────────────────────────────────────────────────────

const ALERT_TYPES: { type: AlertType; label: string; defaultDays: number[] }[] = [
  { type: "payment_due",        label: "Landowner/Agency Payment Due",   defaultDays: [7, 3, 1] },
  { type: "invoice_overdue",    label: "Client Invoice Overdue",         defaultDays: [1, 7, 15, 30] },
  { type: "contract_renewal",   label: "Contract Renewal Approaching",   defaultDays: [90, 60, 30] },
  { type: "campaign_ending",    label: "Campaign Ending Soon",           defaultDays: [30, 15, 7] },
  { type: "site_available",     label: "Site Became Available",          defaultDays: [0] },
  { type: "municipal_expiry",   label: "Municipal Permit Expiry",        defaultDays: [60, 30] },
  { type: "mounting_scheduled", label: "Mounting Scheduled Tomorrow",    defaultDays: [1] },
  { type: "payment_overdue",    label: "Payment Overdue (Internal)",     defaultDays: [1, 7] },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrefRow {
  alert_type: AlertType;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
  advance_days: number[];
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-muted-foreground/30 dark:bg-muted-foreground/40"}`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform m-0.5 ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  preferences: AlertPreference[];
}

export function AlertPreferences({ preferences }: Props) {
  const [isPending, startTransition] = useTransition();

  // Build initial state: merge DB preferences with defaults
  const initialRows: PrefRow[] = ALERT_TYPES.map(({ type, defaultDays }) => {
    const existing = preferences.find((p) => p.alert_type === type);
    return {
      alert_type: type,
      in_app: existing?.in_app ?? true,
      email: existing?.email ?? false,
      whatsapp: existing?.whatsapp ?? false,
      advance_days: existing?.advance_days ?? defaultDays,
    };
  });

  const [rows, setRows] = useState<PrefRow[]>(initialRows);
  const [editingDays, setEditingDays] = useState<Record<AlertType, string>>({} as Record<AlertType, string>);
  const [savingType, setSavingType] = useState<AlertType | null>(null);

  function updateRow(type: AlertType, patch: Partial<PrefRow>) {
    setRows((prev) => prev.map((r) => r.alert_type === type ? { ...r, ...patch } : r));
  }

  function handleDaysInput(type: AlertType, value: string) {
    setEditingDays((prev) => ({ ...prev, [type]: value }));
  }

  function commitDays(type: AlertType) {
    const raw = editingDays[type];
    if (raw === undefined) return;
    const parsed = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 0);
    updateRow(type, { advance_days: parsed.length ? parsed : [7] });
    // Clear the editing state so the display reverts to the stored value
    setEditingDays((prev) => { const n = { ...prev }; delete n[type]; return n; });
  }

  function handleSave(row: PrefRow) {
    setSavingType(row.alert_type);
    startTransition(async () => {
      const res = await upsertAlertPreference(row);
      if (res.error) toast.error(res.error);
      else toast.success("Preference saved");
      setSavingType(null);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Alert Preferences</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure how and when you receive each type of alert. Changes apply to your account only.
        </p>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="hidden md:grid grid-cols-[1fr_64px_64px_64px_160px_80px] gap-2 items-center px-4 py-2 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <span>Alert Type</span>
          <span className="text-center">In-App</span>
          <span className="text-center">Email</span>
          <span className="text-center">WhatsApp</span>
          <span>Advance Days</span>
          <span />
        </div>

        {rows.map((row, i) => {
          const cfg = ALERT_TYPES[i];
          const daysDisplayValue = editingDays[row.alert_type] !== undefined
            ? editingDays[row.alert_type]
            : row.advance_days.join(", ");

          return (
            <div key={row.alert_type} className="grid grid-cols-1 md:grid-cols-[1fr_64px_64px_64px_160px_80px] gap-2 items-center px-4 py-3 border-b border-border last:border-0">
              {/* Label */}
              <div>
                <p className="text-sm font-medium">{cfg.label}</p>
                <p className="text-xs text-muted-foreground md:hidden mt-1">
                  In-app: {row.in_app ? "On" : "Off"} · Email: {row.email ? "On" : "Off"} · WA: {row.whatsapp ? "On" : "Off"}
                </p>
              </div>

              {/* In-app toggle */}
              <div className="hidden md:flex justify-center">
                <Toggle checked={row.in_app} onChange={(v) => updateRow(row.alert_type, { in_app: v })} />
              </div>

              {/* Email toggle */}
              <div className="hidden md:flex justify-center">
                <Toggle checked={row.email} onChange={(v) => updateRow(row.alert_type, { email: v })} />
              </div>

              {/* WhatsApp toggle */}
              <div className="hidden md:flex justify-center">
                <Toggle checked={row.whatsapp} onChange={(v) => updateRow(row.alert_type, { whatsapp: v })} />
              </div>

              {/* Advance days */}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={daysDisplayValue}
                  onChange={(e) => handleDaysInput(row.alert_type, e.target.value)}
                  onBlur={() => commitDays(row.alert_type)}
                  className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="e.g. 7, 3, 1"
                  aria-label="Advance days (comma separated)"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap hidden lg:block">days</span>
              </div>

              {/* Save button */}
              <div className="flex justify-end md:justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleSave(row)}
                  disabled={isPending && savingType === row.alert_type}
                >
                  {isPending && savingType === row.alert_type
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : "Save"
                  }
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Advance Days:</strong> comma-separated list of how many days before the event you want an alert. E.g. &ldquo;7, 3, 1&rdquo; means alerts at 7 days, 3 days, and 1 day before.
      </p>
    </div>
  );
}
