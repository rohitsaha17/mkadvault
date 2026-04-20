"use client";
// Bell icon in the TopBar — shows unread count, dropdown with recent alerts.
// Re-fetches every 60s via SWR-style polling so new alerts appear without refresh.

import { useState, useEffect, useTransition, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  Bell, X, CheckCheck, AlertTriangle, Info, AlertOctagon, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { markAlertRead, markAllAlertsRead, dismissAlert } from "@/app/[locale]/(dashboard)/notifications/actions";
import type { Alert, AlertType } from "@/lib/types/database";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  payment_due: "Payment Due",
  payment_overdue: "Payment Overdue",
  contract_renewal: "Contract Renewal",
  campaign_ending: "Campaign Ending",
  site_available: "Site Available",
  municipal_expiry: "Permit Expiry",
  invoice_overdue: "Invoice Overdue",
  mounting_scheduled: "Mounting Scheduled",
};

function SeverityIcon({ severity, className }: { severity: string; className?: string }) {
  if (severity === "critical") return <AlertOctagon className={cn("h-4 w-4 text-red-500", className)} />;
  if (severity === "warning") return <AlertTriangle className={cn("h-4 w-4 text-amber-500", className)} />;
  return <Info className={cn("h-4 w-4 text-blue-500", className)} />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  initialUnreadCount?: number;
  locale: string;
}

export function NotificationBell({ initialUnreadCount = 0, locale }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Stabilise the Supabase client so it's created only once (avoids re-render loops
  // from the useEffect dependency changing on every render).
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Load recent alerts when dropdown opens
  async function loadAlerts() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) { setLoading(false); return; }

    const { data } = await supabase
      .from("alerts")
      .select("*")
      .eq("organization_id", profile.org_id)
      .eq("is_dismissed", false)
      .or(`user_id.eq.${user.id},target_role.eq.${profile.role}`)
      .order("created_at", { ascending: false })
      .limit(20);

    setAlerts((data ?? []) as Alert[]);
    setUnreadCount((data ?? []).filter((a) => !a.is_read).length);
    setLoading(false);
  }

  // Poll unread count every 60 seconds
  useEffect(() => {
    async function fetchCount() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("org_id, role").eq("id", user.id).single();
      if (!profile) return;
      const { count } = await supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", profile.org_id)
        .eq("is_dismissed", false)
        .eq("is_read", false)
        .or(`user_id.eq.${user.id},target_role.eq.${profile.role}`);
      setUnreadCount(count ?? 0);
    }

    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, [supabase]);

  function handleOpen() {
    setOpen((v) => !v);
    if (!open) loadAlerts();
  }

  function handleClickAlert(alert: Alert) {
    startTransition(async () => {
      if (!alert.is_read) await markAlertRead(alert.id);
      setOpen(false);
      router.push(alertEntityUrl(alert, locale) as "/");
    });
  }

  function handleDismiss(e: React.MouseEvent, alertId: string) {
    e.stopPropagation();
    startTransition(async () => {
      await dismissAlert(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllAlertsRead();
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
      setUnreadCount(0);
    });
  }

  return (
    <div className="relative">
      {/* Bell button */}
      <Button
        variant="ghost"
        size="icon"
        className="relative h-8 w-8"
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 bg-background border border-border rounded-xl shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm">Notifications</h2>
                {unreadCount > 0 && (
                  <Badge className="h-4 px-1.5 text-[10px] bg-red-500 hover:bg-red-500">
                    {unreadCount}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-muted-foreground"
                    onClick={handleMarkAllRead}
                    disabled={isPending}
                  >
                    <CheckCheck className="h-3 w-3" />
                    Mark all read
                  </Button>
                )}
              </div>
            </div>

            {/* Alert list */}
            <div className="max-h-96 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  Loading…
                </div>
              )}
              {!loading && alerts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Bell className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">All caught up!</p>
                </div>
              )}
              {!loading && alerts.map((alert) => (
                <div
                  key={alert.id}
                  onClick={() => handleClickAlert(alert)}
                  className={cn(
                    "flex gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 border-b border-border last:border-0 transition-colors",
                    !alert.is_read && "bg-blue-50/50 dark:bg-blue-950/20"
                  )}
                >
                  {/* Icon */}
                  <div className="shrink-0 mt-0.5">
                    <SeverityIcon severity={alert.severity} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-sm leading-tight", !alert.is_read && "font-semibold")}>
                        {alert.title}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => handleDismiss(e, alert.id)}
                        className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        aria-label="Dismiss"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {alert.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground/70">
                        {timeAgo(alert.created_at)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">•</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {ALERT_TYPE_LABELS[alert.alert_type]}
                      </span>
                      {!alert.is_read && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-2.5 flex justify-between items-center">
              <button
                type="button"
                onClick={() => { setOpen(false); router.push(`/${locale}/notifications` as "/"); }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                View all notifications
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
