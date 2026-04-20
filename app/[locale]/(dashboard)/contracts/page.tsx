// Contracts list — themed to match the app-wide UI overhaul.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, AlertTriangle, Pencil, FileText } from "lucide-react";
import { differenceInDays } from "date-fns";
import { inr, fmt } from "@/lib/utils";
import type { Contract, Landowner, PartnerAgency, Site } from "@/lib/types/database";

export const metadata = { title: "Contracts" };

const PAGE_SIZE = 20;

export default async function ContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contracts");

  const { tab = "all", page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const offset = (currentPage - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const in90DaysDate = new Date();
  in90DaysDate.setDate(in90DaysDate.getDate() + 90);
  const in90Days = in90DaysDate.toISOString().slice(0, 10);

  let query = supabase
    .from("contracts")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("start_date", { ascending: false });

  if (tab === "expiring") {
    query = query
      .eq("status", "active")
      .not("end_date", "is", null)
      .lte("end_date", in90Days)
      .gte("end_date", today);
  } else if (tab === "expired") {
    query = query.in("status", ["expired", "terminated"]);
  } else {
    query = query.eq("status", "active");
  }

  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  const contracts = (data ?? []) as unknown as Contract[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Counts for tab badges
  const [{ count: expiringCount }, { count: expiredCount }] = await Promise.all([
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("status", "active")
      .not("end_date", "is", null)
      .lte("end_date", in90Days)
      .gte("end_date", today),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .in("status", ["expired", "terminated"]),
  ]);

  // Fetch counterparties + sites for display
  const landownerIds = [
    ...new Set(contracts.map((c) => c.landowner_id).filter(Boolean)),
  ] as string[];
  const agencyIds = [
    ...new Set(contracts.map((c) => c.agency_id).filter(Boolean)),
  ] as string[];
  const siteIds = [...new Set(contracts.map((c) => c.site_id))];

  const [{ data: lData }, { data: aData }, { data: sData }] = await Promise.all([
    landownerIds.length > 0
      ? supabase.from("landowners").select("id, full_name").in("id", landownerIds)
      : { data: [] },
    agencyIds.length > 0
      ? supabase.from("partner_agencies").select("id, agency_name").in("id", agencyIds)
      : { data: [] },
    siteIds.length > 0
      ? supabase.from("sites").select("id, name, site_code").in("id", siteIds)
      : { data: [] },
  ]);

  const landownerMap = new Map(
    (lData ?? []).map((l) => [
      l.id,
      (l as unknown as Pick<Landowner, "id" | "full_name">).full_name,
    ])
  );
  const agencyMap = new Map(
    (aData ?? []).map((a) => [
      a.id,
      (a as unknown as Pick<PartnerAgency, "id" | "agency_name">).agency_name,
    ])
  );
  const siteMap = new Map(
    (sData ?? []).map((s) => [s.id, s as unknown as Pick<Site, "id" | "name" | "site_code">])
  );

  const TABS = [
    { key: "all", label: "Active", count: null as number | null },
    { key: "expiring", label: "Expiring Soon", count: expiringCount ?? 0 },
    { key: "expired", label: "Expired", count: expiredCount ?? 0 },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/contracts/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Contract
            </Button>
          </Link>
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((tabItem) => (
          <Link
            key={tabItem.key}
            href={`/contracts?tab=${tabItem.key}`}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === tabItem.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tabItem.key === "expiring" && tabItem.count !== null && tabItem.count > 0 && (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            )}
            {tabItem.label}
            {tabItem.count !== null && tabItem.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  tabItem.key === "expiring"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tabItem.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {total > 0 && (
        <p className="text-xs text-muted-foreground mb-3 tabular-nums">
          Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} contract{total !== 1 ? "s" : ""}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load contracts: {error.message}
        </div>
      )}

      {!error && contracts.length === 0 && (
        <EmptyState
          variant="card"
          icon={<FileText className="h-7 w-7" />}
          title={tab !== "all" ? t("noContractsFiltered") : t("noContracts")}
          description={
            tab !== "all"
              ? t("noContractsFilteredDesc")
              : t("noContractsDesc")
          }
          action={
            tab === "all" ? (
              <Link href="/contracts/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  New Contract
                </Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {!error && contracts.length > 0 && (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Party</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => {
                  const party =
                    c.contract_type === "landowner"
                      ? landownerMap.get(c.landowner_id ?? "")
                      : agencyMap.get(c.agency_id ?? "");
                  const site = siteMap.get(c.site_id);
                  const daysToExpiry = c.end_date
                    ? differenceInDays(new Date(c.end_date), new Date())
                    : null;
                  const isExpiringSoon =
                    daysToExpiry !== null && daysToExpiry <= 90 && daysToExpiry >= 0;

                  return (
                    <TableRow
                      key={c.id}
                      className={isExpiringSoon ? "bg-amber-50/40 dark:bg-amber-500/5" : ""}
                    >
                      <TableCell>
                        <Link
                          href={`/contracts/${c.id}`}
                          className="font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {party ?? "—"}
                        </Link>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          {c.contract_type}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {site ? (
                          <>
                            <p className="text-foreground">{site.name}</p>
                            {site.site_code && (
                              <p className="font-mono text-muted-foreground/70">
                                {site.site_code}
                              </p>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        <p className="text-foreground">{fmt(c.start_date)}</p>
                        <p>→ {fmt(c.end_date)}</p>
                        {isExpiringSoon && (
                          <p className="mt-0.5 flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {daysToExpiry}d left
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground tabular-nums">
                        {c.payment_model === "revenue_share"
                          ? `${c.revenue_share_percentage ?? "—"}% rev share`
                          : inr(c.rent_amount_paise)}
                        <p className="text-[11px] text-muted-foreground capitalize font-normal">
                          {c.payment_model.replace(/_/g, " ")}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/contracts/${c.id}/edit`}>
                            <Button variant="ghost" size="icon-sm" aria-label="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {currentPage > 1 && (
                <Link href={`/contracts?tab=${tab}&page=${currentPage - 1}`}>
                  <Button variant="outline" size="sm">← Previous</Button>
                </Link>
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link href={`/contracts?tab=${tab}&page=${currentPage + 1}`}>
                  <Button variant="outline" size="sm">Next →</Button>
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
