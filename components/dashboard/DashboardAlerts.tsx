"use client";

// DashboardAlerts — compact alert list rendered on the owner dashboard.
//
// Shows up to 5 critical/warning alerts with severity icon, title, truncated
// message, and a "View" link to the relevant entity.
// If there are no alerts, renders a green "all clear" message.
// A "View all alerts" link at the bottom navigates to /[locale]/notifications.

import Link from "next/link";
import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Alert, AlertEntityType } from "@/lib/types/database";

// ─── Entity URL helper ────────────────────────────────────────────────────────
// Maps entity types to their dashboard route.

function entityUrl(
  locale: string,
  entityType: AlertEntityType | null,
  entityId: string | null
): string | null {
  if (!entityType || !entityId) return null;

  switch (entityType) {
    case "contract":
    case "contract_payment":
      return `/${locale}/contracts/${entityId}`;
    case "campaign":
      return `/${locale}/campaigns/${entityId}`;
    case "invoice":
      return `/${locale}/billing/invoices/${entityId}`;
    case "site":
      return `/${locale}/sites/${entityId}`;
    default:
      return null;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  alerts: Alert[];
  locale: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DashboardAlerts({ alerts, locale }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Critical Alerts</CardTitle>
      </CardHeader>

      <CardContent className="space-y-1 pb-3">
        {alerts.length === 0 ? (
          // All-clear state
          <div className="flex items-center gap-3 py-4 text-green-600">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">No critical alerts — everything looks good.</span>
          </div>
        ) : (
          <>
            {alerts.slice(0, 5).map((alert) => {
              const url = entityUrl(
                locale,
                alert.related_entity_type,
                alert.related_entity_id
              );

              const isCritical = alert.severity === "critical";

              return (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-muted transition-colors"
                >
                  {/* Severity icon */}
                  {isCritical ? (
                    <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  )}

                  {/* Text block */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-snug">
                      {alert.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {alert.message}
                    </p>
                  </div>

                  {/* View link — only if we have a URL */}
                  {url && (
                    <Link
                      href={url}
                      className="shrink-0 text-xs font-medium text-blue-600 hover:underline"
                    >
                      View
                    </Link>
                  )}
                </div>
              );
            })}
          </>
        )}
      </CardContent>

      {/* Footer: View all link */}
      <div className="border-t px-6 py-2.5">
        <Link
          href={`/${locale}/notifications`}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          View all alerts →
        </Link>
      </div>
    </Card>
  );
}
