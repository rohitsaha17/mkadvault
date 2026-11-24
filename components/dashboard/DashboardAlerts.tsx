"use client";

// DashboardAlerts — compact alert list rendered on the owner dashboard.
//
// Shows up to 5 critical/warning alerts with severity icon, title, truncated
// message, and a "View" link to the relevant entity.
// If there are no alerts, shows the bell and an "all clear" line.
// A "View all alerts" link in the header goes to /[locale]/notifications.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertOctagon, AlertTriangle, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/dashboard/IconTile";
import { cn } from "@/lib/utils";
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
  const t = useTranslations("dashboard");

  return (
    <Card className="rounded-3xl">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-xl">{t("critical_alerts")}</CardTitle>
        <Link href={`/${locale}/notifications`} className="btn-pill-ghost">
          {t("view_all_alerts")}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>

      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-4 rounded-2xl bg-muted/50 p-4">
            <IconTile name="bell" size={64} />
            <div>
              <p className="font-heading text-lg font-semibold">
                {t("all_clear")}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("all_clear_sub")}
              </p>
            </div>
          </div>
        ) : (
          <ul className="-mx-2 space-y-1">
            {alerts.slice(0, 5).map((alert) => {
              const url = entityUrl(
                locale,
                alert.related_entity_type,
                alert.related_entity_id
              );
              const isCritical = alert.severity === "critical";
              const Icon = isCritical ? AlertOctagon : AlertTriangle;

              return (
                <li
                  key={alert.id}
                  className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full",
                      isCritical
                        ? "bg-destructive/12 text-destructive"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">
                      {alert.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {alert.message}
                    </p>
                  </div>
                  {url && (
                    <Link
                      href={url}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      {t("view")}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
