"use client";
// Full notifications page — table with filters, bulk actions, click-through navigation.

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  Bell, AlertOctagon, AlertTriangle, Info, CheckCheck, Trash2, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { bulkMarkRead, bulkDismiss } from "@/app/[locale]/(dashboard)/notifications/actions";
import type { Alert, AlertType, AlertSeverity } from "@/lib/types/database";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function alertEntityUrl(alert: Alert, locale: string): string {
  const base = `/${locale}`;
  switch (alert.related_entity_type) {
    case "contract":
    case "contract_payment":
      return alert.related_entity_id ? `${base}/contracts/${alert.related_entity_id}` : `${base}/contracts`;
    case "campaign":
      return alert.related_entity_id ? `${base}/campaigns/${alert.related_entity_id}` : `${base}/campaigns`;
    case "invoice":
      return alert.related_entity_id ? `${base}/billing/invoices/${alert.related_entity_id}` : `${base}/billing/invoices`;
    case "site":
      return alert.related_entity_id ? `${base}/sites/${alert.related_entity_id}` : `${base}/sites`;
    default:
      return `${base}/notifications`;
  }
}

const TYPE_LABELS: Record<AlertType, string> = {
  payment_due: "Payment Due",
  payment_overdue: "Payment Overdue",
  contract_renewal: "Contract Renewal",
  campaign_ending: "Campaign Ending",
  site_available: "Site Available",
  municipal_expiry: "Permit Expiry",
  invoice_overdue: "Invoice Overdue",
  mounting_scheduled: "Mounting Scheduled",
};

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; className: string }> = {
  info: {
    label: "Info",
    className:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  },
  warning: {
    label: "Warning",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  },
  critical: {
    label: "Critical",
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  },
};

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === "critical") return <AlertOctagon className="h-4 w-4 text-red-500 shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  alerts: Alert[];
  locale: string;
}

type FilterType = AlertType | "all";
type FilterSeverity = AlertSeverity | "all";
type FilterRead = "all" | "unread" | "read";

export function NotificationsClient({ alerts: initialAlerts, locale }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>("all");
  const [filterRead, setFilterRead] = useState<FilterRead>("all");
  const [search, setSearch] = useState("");

  // Filtered list
  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (filterType !== "all" && a.alert_type !== filterType) return false;
      if (filterSeverity !== "all" && a.severity !== filterSeverity) return false;
      if (filterRead === "unread" && a.is_read) return false;
      if (filterRead === "read" && !a.is_read) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.title.toLowerCase().includes(q) && !a.message.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [alerts, filterType, filterSeverity, filterRead, search]);

  const unreadCount = alerts.filter((a) => !a.is_read).length;
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  }

  function handleBulkMarkRead() {
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await bulkMarkRead(ids);
      if (res.error) { toast.error(res.error); return; }
      setAlerts((prev) => prev.map((a) => selected.has(a.id) ? { ...a, is_read: true } : a));
      setSelected(new Set());
      toast.success("Marked as read");
    });
  }

  function handleBulkDismiss() {
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await bulkDismiss(ids);
      if (res.error) { toast.error(res.error); return; }
      setAlerts((prev) => prev.filter((a) => !selected.has(a.id)));
      setSelected(new Set());
      toast.success("Dismissed");
    });
  }

  function handleClickRow(alert: Alert) {
    startTransition(async () => {
      router.push(alertEntityUrl(alert, locale) as "/");
    });
  }

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Notifications"
        description={
          unreadCount > 0
            ? `${unreadCount} unread · ${alerts.length} total`
            : `All caught up · ${alerts.length} total`
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search notifications…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 text-sm"
        />

        <select
          value={filterRead}
          onChange={(e) => setFilterRead(e.target.value as FilterRead)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>

        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as FilterSeverity)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as FilterType)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {(filterType !== "all" || filterSeverity !== "all" || filterRead !== "all" || search) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => { setFilterType("all"); setFilterSeverity("all"); setFilterRead("all"); setSearch(""); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handleBulkMarkRead}
            disabled={isPending}
          >
            <CheckCheck className="h-3 w-3" />
            Mark read
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs text-red-600 hover:text-red-700"
            onClick={handleBulkDismiss}
            disabled={isPending}
          >
            <Trash2 className="h-3 w-3" />
            Dismiss
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16">
          <Bell className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No notifications match your filters.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="accent-blue-600"
              aria-label="Select all"
            />
            <span className="w-4" />
            <span className="flex-1">Alert</span>
            <span className="w-24 text-right hidden sm:block">When</span>
            <span className="w-20 hidden md:block">Severity</span>
            <span className="w-8" />
          </div>

          {/* Rows */}
          {filtered.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/40 group",
                !alert.is_read && "bg-blue-50/50 dark:bg-blue-950/20"
              )}
              onClick={() => handleClickRow(alert)}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(alert.id)}
                onChange={(e) => { e.stopPropagation(); toggleSelect(alert.id); }}
                className="accent-blue-600 mt-0.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              />

              {/* Severity icon */}
              <div className="mt-0.5">
                <SeverityIcon severity={alert.severity} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={cn("text-sm truncate", !alert.is_read && "font-semibold")}>
                    {alert.title}
                  </p>
                  {!alert.is_read && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{alert.message}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {TYPE_LABELS[alert.alert_type]}
                  </Badge>
                </div>
              </div>

              {/* Timestamp */}
              <div className="hidden sm:block text-right shrink-0 w-24">
                <p className="text-xs text-muted-foreground">{timeAgo(alert.created_at)}</p>
                <p className="text-[10px] text-muted-foreground/60">{fmtDate(alert.created_at)}</p>
              </div>

              {/* Severity badge */}
              <div className="hidden md:flex items-center w-20 shrink-0">
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                  SEVERITY_CONFIG[alert.severity].className
                )}>
                  {SEVERITY_CONFIG[alert.severity].label}
                </span>
              </div>

              {/* External link */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-8 flex justify-center">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
