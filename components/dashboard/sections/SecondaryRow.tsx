// Money still moving: receivables by age, what's payable next, and the live
// campaigns that end soonest. Own Suspense boundary.
//
// The third card used to be "Campaign pipeline", which held one number — the
// live count — that the hero hoarding now shows. "Ending next" uses the space
// for something to act on.
import Image from "next/image";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { getTranslations } from "next-intl/server";
import { ArrowUpRight, CircleAlert, CircleCheck } from "lucide-react";
import trails from "@/assets/dashboard/light-trails.webp";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { IconTile, type IconName } from "@/components/dashboard/IconTile";
import { loadPayablesSummary } from "@/lib/payables";
import { OPEN_INVOICE_STATUSES, summariseReceivables } from "@/lib/receivables";
import { createClient } from "@/lib/supabase/server";
import { cn, fmt, inr } from "@/lib/utils";
import { todayInIndia } from "@/lib/utils/time-buckets";

export async function SecondaryRow({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const t = await getTranslations("dashboard");

  const today = todayInIndia();

  const [
    { data: openInvoices, error: receivablesError },
    payables,
    { data: endingCampaigns },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("due_date, balance_due_paise, status")
      .eq("organization_id", orgId)
      .in("status", OPEN_INVOICE_STATUSES)
      .is("deleted_at", null),
    loadPayablesSummary(supabase, today),
    supabase
      .from("campaigns")
      .select(
        "id, campaign_name, end_date, client:clients(company_name), agency:partner_agencies!billed_agency_id(agency_name)",
      )
      .eq("organization_id", orgId)
      .eq("status", "live")
      .is("deleted_at", null)
      .lte("start_date", today)
      .gte("end_date", today)
      .order("end_date")
      .limit(4),
  ]);

  const receivables = summariseReceivables(openInvoices ?? [], today);
  const agingTotal = receivables.outstanding;
  const aging = [
    { label: t("not_due"), amount: receivables.ageing.notDue, fill: "bg-chart-1" },
    { label: t("days_1_30"), amount: receivables.ageing.d1to30, fill: "bg-chart-3/60" },
    { label: t("days_31_60"), amount: receivables.ageing.d31to60, fill: "bg-chart-3" },
    { label: t("days_61_90"), amount: receivables.ageing.d61to90, fill: "bg-chart-4" },
    { label: t("days_90_plus"), amount: receivables.ageing.d90plus, fill: "bg-chart-5" },
  ];

  const ending = (endingCampaigns ?? []) as unknown as Array<{
    id: string;
    campaign_name: string;
    end_date: string;
    client: { company_name: string } | null;
    // Set when an agency is billed instead of the client.
    agency: { agency_name: string } | null;
  }>;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {/* Receivables aging */}
      <Card className="rounded-3xl">
        <CardContent className="flex h-full flex-col gap-5">
          <PanelTop icon="coins" title={t("outstanding_ar")} />
          <div>
            <p className="text-xs text-muted-foreground">
              {t("total_outstanding")}
            </p>
            <p className="figure mt-1.5 text-3xl">
              {receivablesError ? "—" : inr(agingTotal)}
            </p>
            {receivables.overdueCount > 0 && (
              <Link
                href="/billing/invoices?tab=overdue"
                className="mt-2 inline-block text-xs font-medium text-destructive hover:underline"
              >
                {t("receivables_overdue", {
                  value: inr(receivables.overdue),
                  count: receivables.overdueCount,
                })}
              </Link>
            )}
          </div>
          {agingTotal > 0 && (
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
              {aging
                .filter((b) => b.amount > 0)
                .map((b) => (
                  <span
                    key={b.label}
                    className={cn("h-full min-w-1", b.fill)}
                    style={{ width: `${(b.amount / agingTotal) * 100}%` }}
                  />
                ))}
            </div>
          )}
          <ul className="space-y-2.5">
            {aging.map((b) => (
              <li
                key={b.label}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2.5 text-muted-foreground">
                  <span className={cn("size-2.5 rounded-full", b.fill)} />
                  {b.label}
                </span>
                <span className="font-medium tabular-nums">
                  {receivablesError ? "—" : inr(b.amount)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Payables — dark in both themes, over the traffic light trails */}
      <div className="dark relative isolate flex min-h-72 flex-col justify-between gap-5 overflow-hidden rounded-3xl bg-[#090d08] p-5 text-foreground ring-1 ring-inset ring-white/8">
        <Image
          src={trails}
          alt=""
          fill
          sizes="(min-width: 80rem) 370px, (min-width: 48rem) 50vw, 100vw"
          className="-z-10 object-cover object-[78%_100%] opacity-90 mix-blend-screen"
        />
        <div className="space-y-5">
          <PanelTop icon="receipt" title={t("outstanding_payables")} />
          <div>
            <p className="text-xs text-white/70">{t("payables_due")}</p>
            <p className="figure mt-1.5 text-3xl">
              {payables ? inr(payables.dueSoon) : "—"}
            </p>
            {payables && payables.dueSoonCount > 0 && (
              <p className="mt-2 text-xs text-white/70">
                {t("payments_count", { count: payables.dueSoonCount })}
              </p>
            )}
          </div>
        </div>
        {payables === null ? (
          <p className="glass rounded-2xl p-4 text-sm text-white/80">
            {t("payables_error")}
          </p>
        ) : payables.overdueCount > 0 ? (
          <Link
            href="/billing/payables?tab=overdue"
            className="group flex items-center justify-between gap-3 rounded-2xl border border-destructive/55 bg-[#240b09]/90 p-4 backdrop-blur-md transition-colors hover:border-destructive"
          >
            <span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <CircleAlert className="size-4" aria-hidden />
                {t("overdue")}
              </span>
              <span className="figure mt-2 block text-2xl text-white">
                {inr(payables.overdue)}
              </span>
              <span className="mt-2 block text-xs text-white/75">
                {t("overdue_detail", {
                  count: payables.overdueCount,
                  date: fmt(payables.oldestOverdue),
                })}
              </span>
            </span>
            <ArrowUpRight
              className="size-5 shrink-0 text-white/60 transition-colors group-hover:text-white"
              aria-hidden
            />
          </Link>
        ) : (
          <div className="glass flex items-center justify-between gap-3 rounded-2xl p-4">
            <div>
              <p className="text-xs text-white/70">{t("overdue")}</p>
              <p className="figure mt-1.5 text-xl">{inr(0)}</p>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-volt">
              <CircleCheck className="size-4" aria-hidden />
              {t("nothing_overdue")}
            </span>
          </div>
        )}
      </div>

      {/* Ending next */}
      <Card className="rounded-3xl md:col-span-2 xl:col-span-1">
        <CardContent className="flex h-full flex-col gap-4">
          <PanelTop icon="calendar" title={t("ending_next")} />
          {ending.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("no_endings")}
            </p>
          ) : (
            <ul className="-mx-2 space-y-1">
              {ending.map((c) => {
                const days = differenceInCalendarDays(
                  parseISO(c.end_date),
                  parseISO(today),
                );
                const party =
                  c.client?.company_name ?? c.agency?.agency_name ?? null;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60"
                    >
                      <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-xs font-semibold"
                      >
                        {initials(party ?? c.campaign_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.campaign_name}
                        </span>
                        {party && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {party}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                            days <= 7
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {days === 0
                            ? t("ends_today")
                            : t("ends_in_days", { count: days })}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {fmt(c.end_date)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href="/campaigns?status=live"
            className="btn-pill-ghost mt-auto w-fit"
          >
            {t("view_campaigns")}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function PanelTop({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xl font-semibold">{title}</h3>
      <IconTile name={icon} size={46} />
    </div>
  );
}

/** Up to two initials, skipping words that don't start with a letter. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
