// Campaigns list — themed to match the app-wide UI overhaul.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Plus, Search, LayoutList, Columns, Pencil, Megaphone } from "lucide-react";
import { KanbanBoard } from "@/components/campaigns/KanbanBoard";
import { ListExportMenu } from "@/components/shared/ListExportMenu";
import { SortableTableHead } from "@/components/shared/SortableTableHead";
import { sanitizeSearch, fmt, inr } from "@/lib/utils";
import {
  DATE_RANGE_LABELS,
  DATE_RANGE_ORDER,
  describeDateRange,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/utils/date-ranges";
import type { Campaign, Client, PartnerAgency, CampaignStatus } from "@/lib/types/database";

export const metadata = { title: "Campaigns" };

const PAGE_SIZE = 25;

// Supabase returns to-one relations as either an object or a one-element
// array depending on inference. We normalise both shapes to a single
// object / null.
type Rel<T> = T | T[] | null | undefined;
function one<T>(rel: Rel<T>): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

interface CampaignWithBillingParty extends Campaign {
  client?: Rel<Pick<Client, "id" | "company_name">>;
  agency?: Rel<Pick<PartnerAgency, "id" | "agency_name">>;
}

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; view?: string; page?: string; sort?: string; dir?: string; range?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("campaigns");

  const { q, status, view = "table", page, sort, dir, range: rangeParam } = await searchParams;
  // Validate sort column against allowlist. Default is "start_date" DESC so
  // the newest campaigns (most recent start date) show first — which is
  // what users mean by "newest first" for bookings. "Created at" is still
  // a valid sort key if someone passes it via ?sort=created_at.
  const SORTABLE_COLS = ["campaign_name", "start_date", "total_value_paise", "status", "created_at"];
  const sortCol = sort && SORTABLE_COLS.includes(sort) ? sort : "start_date";
  const sortDir = dir === "asc" ? "asc" : "desc";
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Date-range preset: validates against the known set; anything else is
  // treated as "all" (no date filter). The filter applies to start_date —
  // "campaigns that started during this period".
  const rangeCandidates: DateRangePreset[] = [...DATE_RANGE_ORDER];
  const rangePreset: DateRangePreset =
    rangeParam && rangeCandidates.includes(rangeParam as DateRangePreset)
      ? (rangeParam as DateRangePreset)
      : "all";
  const dateRange = resolveDateRange(rangePreset);

  const supabase = await createClient();

  // Load both sides of the billing party in one query: campaigns billed
  // to a client join `clients`; campaigns billed to an agency join
  // `partner_agencies` via billed_agency_id. We render whichever is
  // populated in the list's Client / Agency column.
  let query = supabase
    .from("campaigns")
    .select(
      "*, client:clients(id, company_name), agency:partner_agencies!billed_agency_id(id, agency_name)",
      { count: "exact" },
    )
    .is("deleted_at", null)
    .order(sortCol, { ascending: sortDir === "asc" });

  if (q) {
    query = query.ilike("campaign_name", `%${sanitizeSearch(q)}%`);
  }
  if (status) {
    query = query.eq("status", status as CampaignStatus);
  }
  if (dateRange) {
    // Filter on start_date: "campaigns that started during the selected
    // period". If you need overlap semantics later (campaigns that were
    // ACTIVE during the period, including ones that started earlier),
    // swap for .or(`and(start_date.lte.${to},end_date.gte.${from})`).
    query = query
      .gte("start_date", dateRange.from)
      .lte("start_date", dateRange.to);
  }

  if (view === "table") {
    query = query.range(offset, offset + PAGE_SIZE - 1);
  }

  const { data, count, error } = await query;
  const campaigns = (data ?? []) as unknown as CampaignWithBillingParty[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!(q || status || (rangePreset !== "all"));

  const buildHref = (extra: Record<string, string>) => {
    const p: Record<string, string> = {};
    if (q) p.q = q;
    if (status) p.status = status;
    if (rangePreset !== "all") p.range = rangePreset;
    if (view !== "table") p.view = view;
    if (sort) p.sort = sort;
    if (dir) p.dir = dir;
    return `/campaigns?${new URLSearchParams({ ...p, ...extra })}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ListExportMenu entityType="campaigns" data={campaigns as unknown as Record<string, unknown>[]} filenameBase="campaigns" />
            <Link href="/campaigns/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                New Campaign
              </Button>
            </Link>
          </>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form method="GET" className="flex flex-1 flex-wrap gap-2">
          {view !== "table" && <input type="hidden" name="view" value={view} />}
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Search campaigns…" className="pl-9" />
          </div>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 w-40"
          >
            <option value="">All Statuses</option>
            <option value="live">Live</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            name="range"
            defaultValue={rangePreset}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 w-44"
          >
            {DATE_RANGE_ORDER.map((key) => (
              <option key={key} value={key}>
                {DATE_RANGE_LABELS[key]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">Search</Button>
          {hasFilters && (
            <Link href={view !== "table" ? `/campaigns?view=${view}` : "/campaigns"}>
              <Button variant="ghost" size="sm">Clear</Button>
            </Link>
          )}
        </form>

        {/* View toggle */}
        <div className="flex overflow-hidden rounded-md border border-border bg-muted/30">
          <Link href={buildHref({ view: "table" })}>
            <button
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                view === "table"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <LayoutList className="h-4 w-4" />
              Table
            </button>
          </Link>
          <Link href={buildHref({ view: "kanban" })}>
            <button
              className={`flex items-center gap-1.5 border-l border-border px-3 py-2 text-sm transition-colors ${
                view === "kanban"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Columns className="h-4 w-4" />
              Kanban
            </button>
          </Link>
        </div>
      </div>

      {total > 0 && view === "table" && (
        <p className="text-xs text-muted-foreground mb-3 tabular-nums">
          Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} campaign{total !== 1 ? "s" : ""}
          {dateRange && (
            <span className="ml-2 normal-nums">
              · started between {describeDateRange(dateRange.from, dateRange.to)}
            </span>
          )}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load campaigns: {error.message}
        </div>
      )}

      {!error && campaigns.length === 0 && (
        <EmptyState
          variant="card"
          icon={<Megaphone className="h-7 w-7" />}
          title={hasFilters ? t("noCampaignsFiltered") : t("noCampaigns")}
          description={
            hasFilters
              ? t("noCampaignsFilteredDesc")
              : t("noCampaignsDesc")
          }
          action={
            hasFilters ? (
              <Link href="/campaigns">
                <Button variant="outline" size="sm">Clear all filters</Button>
              </Link>
            ) : (
              <Link href="/campaigns/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  New Campaign
                </Button>
              </Link>
            )
          }
        />
      )}

      {!error && campaigns.length > 0 && view === "kanban" && (
        <KanbanBoard campaigns={campaigns} />
      )}

      {!error && campaigns.length > 0 && view === "table" && (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="campaign_name" label="Campaign" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <TableHead>Client / Agency</TableHead>
                  <SortableTableHead column="start_date" label="Dates" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <SortableTableHead column="total_value_paise" label="Value" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <SortableTableHead column="status" label="Status" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {c.campaign_name}
                        </Link>
                        <code
                          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                          title={`ID: ${c.id}`}
                        >
                          {c.id.slice(0, 8)}
                        </code>
                      </div>
                      {c.campaign_code && (
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                          {c.campaign_code}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(() => {
                        // Prefer the billing party actually in use. If the
                        // campaign is billed to an agency, show the agency
                        // (linked to the agency detail page). Otherwise
                        // show the client (linked to the client page).
                        // Some legacy campaigns may have both set — we
                        // follow billing_party_type to disambiguate.
                        const agency = one(c.agency);
                        const client = one(c.client);
                        const preferAgency =
                          c.billing_party_type === "agency" ||
                          c.billing_party_type === "client_on_behalf_of_agency";
                        if (preferAgency && agency) {
                          return (
                            <Link
                              href={`/agencies/${agency.id}`}
                              className="hover:text-primary transition-colors"
                            >
                              {agency.agency_name}
                              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                agency
                              </span>
                            </Link>
                          );
                        }
                        if (client) {
                          return (
                            <Link
                              href={`/clients/${client.id}`}
                              className="hover:text-primary transition-colors"
                            >
                              {client.company_name}
                            </Link>
                          );
                        }
                        if (agency) {
                          return (
                            <Link
                              href={`/agencies/${agency.id}`}
                              className="hover:text-primary transition-colors"
                            >
                              {agency.agency_name}
                              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                agency
                              </span>
                            </Link>
                          );
                        }
                        return "—";
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {fmt(c.start_date)} – {fmt(c.end_date)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground tabular-nums">
                      {inr(c.total_value_paise)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/campaigns/${c.id}/edit`}>
                          <Button variant="ghost" size="icon-sm" aria-label="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {currentPage > 1 && (
                <Link href={buildHref({ page: String(currentPage - 1) })}>
                  <Button variant="outline" size="sm">← Previous</Button>
                </Link>
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link href={buildHref({ page: String(currentPage + 1) })}>
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
