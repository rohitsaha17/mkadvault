// Sites list page — server component.
// Reads filter/search/page from URL search params, queries Supabase, renders
// a table with client-side filter controls.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Plus, MapPin, Calendar, LayoutList, FileBarChart, Pencil } from "lucide-react";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { SortableTableHead } from "@/components/shared/SortableTableHead";
import { SiteFilters } from "@/components/sites/SiteFilters";
import { DeleteSiteButton } from "@/components/sites/DeleteSiteButton";
import { ListExportMenu } from "@/components/shared/ListExportMenu";
import { sanitizeSearch } from "@/lib/utils";
import type { Site } from "@/lib/types/database";

const PAGE_SIZE = 20;

interface SearchParams {
  q?: string;
  city?: string;
  type?: string;
  status?: string;
  ownership?: string;
  page?: string;
  sort?: string;
  dir?: string;
}

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}

// Format paise → INR display string
function formatRate(paise: number | null): string {
  if (!paise) return "—";
  const inr = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(inr);
}

// Format dimensions
function formatDimensions(site: Site): string {
  if (!site.width_ft || !site.height_ft) return "—";
  return `${site.width_ft} × ${site.height_ft} ft`;
}

export default async function SitesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sites");

  const sp = await searchParams;
  const q = sp.q ?? "";
  const city = sp.city ?? "";
  const type = sp.type ?? "";
  const status = sp.status ?? "";
  const ownership = sp.ownership ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  // Column sorting — validate against allowlist to prevent arbitrary column access
  const SORTABLE_COLUMNS = ["name", "city", "media_type", "status", "base_rate_paise", "site_code"] as const;
  const sortCol = SORTABLE_COLUMNS.includes(sp.sort as typeof SORTABLE_COLUMNS[number])
    ? (sp.sort as string)
    : "city";
  const sortDir = sp.dir === "desc" ? "desc" : "asc";

  const supabase = await createClient();

  // ── Build query ────────────────────────────────────────────────────────────
  let query = supabase
    .from("sites")
    .select(
      "id, site_code, name, media_type, status, city, state, ownership_model, " +
      "width_ft, height_ft, total_sqft, base_rate_paise, deleted_at",
      { count: "exact" }
    )
    .is("deleted_at", null)
    .order(sortCol, { ascending: sortDir === "asc" })
    .range(offset, offset + PAGE_SIZE - 1);

  if (q) {
    // ilike search across name and site_code
    const safe = sanitizeSearch(q);
    query = query.or(`name.ilike.%${safe}%,site_code.ilike.%${safe}%`);
  }
  if (city) query = query.eq("city", city);
  if (type) query = query.eq("media_type", type);
  if (status) query = query.eq("status", status);
  if (ownership) query = query.eq("ownership_model", ownership);

  const { data: sitesData, count, error } = await query;
  const sites = (sitesData ?? []) as unknown as Site[];

  // ── Fetch distinct cities for the filter dropdown ──────────────────────────
  const { data: cityRows } = await supabase
    .from("sites")
    .select("city")
    .is("deleted_at", null)
    .order("city");

  const cities = [...new Set((cityRows ?? []).map((r) => r.city).filter(Boolean))];

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 0;
  const hasFilters = !!(q || city || type || status || ownership);

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ListExportMenu entityType="sites" data={sites as unknown as Record<string, unknown>[]} filenameBase="sites" />
            <Link href="/sites/map">
              <Button variant="outline" size="sm" className="gap-1.5">
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline">Map</span>
              </Button>
            </Link>
            <Link href="/sites/calendar">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Calendar</span>
              </Button>
            </Link>
            <Link href="/proposals/new?mode=rate_card">
              <Button variant="outline" size="sm" className="gap-1.5">
                <FileBarChart className="h-4 w-4" />
                <span className="hidden sm:inline">Rate Card</span>
              </Button>
            </Link>
            <Link href="/sites/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Site
              </Button>
            </Link>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-4">
        <SiteFilters
          cities={cities as string[]}
          currentSearch={q}
          currentCity={city}
          currentType={type}
          currentStatus={status}
          currentOwnership={ownership}
        />
      </div>

      {/* Result count */}
      {count !== null && count !== undefined && count > 0 && (
        <p className="text-xs text-muted-foreground mb-3 tabular-nums">
          Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, count)} of {count} site{count !== 1 ? "s" : ""}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load sites: {error.message}
        </div>
      )}

      {/* Empty state */}
      {!error && sites?.length === 0 && (
        <EmptyState
          variant="card"
          icon={<LayoutList className="h-7 w-7" />}
          title={hasFilters ? t("noSitesFiltered") : t("noSites")}
          description={
            hasFilters
              ? t("noSitesFilteredDesc")
              : t("noSitesDesc")
          }
          action={
            hasFilters ? (
              <Link href="/sites">
                <Button variant="outline" size="sm">Clear all filters</Button>
              </Link>
            ) : (
              <Link href="/sites/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Add Site
                </Button>
              </Link>
            )
          }
        />
      )}

      {/* Table */}
      {!error && sites && sites.length > 0 && (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="site_code" label="Code" currentSort={sp.sort ?? null} currentDir={(sp.dir as "asc" | "desc") ?? null} />
                  <SortableTableHead column="name" label="Name" currentSort={sp.sort ?? null} currentDir={(sp.dir as "asc" | "desc") ?? null} />
                  <SortableTableHead column="media_type" label="Type" currentSort={sp.sort ?? null} currentDir={(sp.dir as "asc" | "desc") ?? null} />
                  <SortableTableHead column="status" label="Status" currentSort={sp.sort ?? null} currentDir={(sp.dir as "asc" | "desc") ?? null} />
                  <SortableTableHead column="city" label="City" currentSort={sp.sort ?? null} currentDir={(sp.dir as "asc" | "desc") ?? null} />
                  <TableHead>Dimensions</TableHead>
                  <SortableTableHead column="base_rate_paise" label="Rate / mo" currentSort={sp.sort ?? null} currentDir={(sp.dir as "asc" | "desc") ?? null} />
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {site.site_code}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/sites/${site.id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {site.name}
                      </Link>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {site.city}, {site.state}
                      </p>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {site.media_type?.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={site.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{site.city}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDimensions(site as Site)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground tabular-nums">
                      {formatRate(site.base_rate_paise)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/sites/${site.id}/edit`}>
                          <Button variant="ghost" size="icon-sm" aria-label="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <DeleteSiteButton siteId={site.id} siteName={site.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-3">
              {page > 1 && (
                <PaginationLink href={buildPageUrl(sp, page - 1)} label="← Previous" />
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <PaginationLink href={buildPageUrl(sp, page + 1)} label="Next →" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Build a page URL preserving existing filter params
function buildPageUrl(sp: SearchParams, newPage: number): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.city) params.set("city", sp.city);
  if (sp.type) params.set("type", sp.type);
  if (sp.status) params.set("status", sp.status);
  if (sp.ownership) params.set("ownership", sp.ownership);
  if (sp.sort) params.set("sort", sp.sort);
  if (sp.dir) params.set("dir", sp.dir);
  if (newPage > 1) params.set("page", String(newPage));
  const qs = params.toString();
  return `/sites${qs ? `?${qs}` : ""}`;
}

function PaginationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm border border-border rounded-md text-muted-foreground hover:bg-muted"
    >
      {label}
    </Link>
  );
}
