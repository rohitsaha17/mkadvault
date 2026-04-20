// Partner agencies list — themed to match the app-wide UI overhaul.
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
import { SortableTableHead } from "@/components/shared/SortableTableHead";
import { Plus, Search, Phone, Mail, MapPin, Pencil, Building2 } from "lucide-react";
import { ListExportMenu } from "@/components/shared/ListExportMenu";
import { sanitizeSearch } from "@/lib/utils";
import type { PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "Partner Agencies" };

const PAGE_SIZE = 20;

export default async function AgenciesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; city?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("agencies");

  const { q, city, page, sort, dir } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Validate sort column against allowlist to prevent injection
  const SORTABLE_COLUMNS = ["agency_name", "city", "contact_person"] as const;
  const sortCol = SORTABLE_COLUMNS.includes(sort as typeof SORTABLE_COLUMNS[number])
    ? (sort as typeof SORTABLE_COLUMNS[number])
    : "agency_name";
  const sortDir = dir === "desc" ? "desc" : "asc";

  const supabase = await createClient();

  let query = supabase
    .from("partner_agencies")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order(sortCol, { ascending: sortDir === "asc" });

  if (q) {
    const safe = sanitizeSearch(q);
    query = query.or(`agency_name.ilike.%${safe}%,contact_person.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  if (city) {
    query = query.ilike("city", `%${sanitizeSearch(city)}%`);
  }

  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  const agencies = (data ?? []) as unknown as PartnerAgency[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!(q || city);

  const buildHref = (extra: Record<string, string>) => {
    const p: Record<string, string> = {};
    if (q) p.q = q;
    if (city) p.city = city;
    if (sort) p.sort = sort;
    if (dir) p.dir = dir;
    return `/agencies?${new URLSearchParams({ ...p, ...extra })}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ListExportMenu entityType="agencies" data={agencies as unknown as Record<string, unknown>[]} filenameBase="agencies" />
            <Link href="/agencies/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Agency
              </Button>
            </Link>
          </>
        }
      />

      {/* Filters */}
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search by name, contact, email…"
            className="pl-9"
          />
        </div>
        <Input name="city" defaultValue={city} placeholder="Filter by city" className="w-40" />
        <Button type="submit" variant="outline" size="sm">Search</Button>
        {hasFilters && (
          <Link href="/agencies">
            <Button variant="ghost" size="sm">Clear</Button>
          </Link>
        )}
      </form>

      {total > 0 && (
        <p className="text-xs text-muted-foreground mb-3 tabular-nums">
          Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} agenc{total !== 1 ? "ies" : "y"}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load agencies: {error.message}
        </div>
      )}

      {!error && agencies.length === 0 && (
        <EmptyState
          variant="card"
          icon={<Building2 className="h-7 w-7" />}
          title={hasFilters ? t("noAgenciesFiltered") : t("noAgencies")}
          description={
            hasFilters
              ? t("noAgenciesFilteredDesc")
              : t("noAgenciesDesc")
          }
          action={
            hasFilters ? (
              <Link href="/agencies">
                <Button variant="outline" size="sm">Clear all filters</Button>
              </Link>
            ) : (
              <Link href="/agencies/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Add Agency
                </Button>
              </Link>
            )
          }
        />
      )}

      {!error && agencies.length > 0 && (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="agency_name" label="Agency Name" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <TableHead>Contact</TableHead>
                  <SortableTableHead column="city" label="Location" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <TableHead>GSTIN</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agencies.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        href={`/agencies/${a.id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {a.agency_name}
                      </Link>
                      {a.contact_person && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {a.contact_person}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="space-y-0.5">
                        {a.phone && (
                          <div className="flex items-center gap-1.5 text-xs tabular-nums">
                            <Phone className="h-3 w-3 shrink-0" />
                            {a.phone}
                          </div>
                        )}
                        {a.email && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Mail className="h-3 w-3 shrink-0" />
                            {a.email}
                          </div>
                        )}
                        {!a.phone && !a.email && (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.city || a.state ? (
                        <div className="flex items-center gap-1 text-xs">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {[a.city, a.state].filter(Boolean).join(", ")}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.gstin ? (
                        <span className="font-mono text-[11px] text-foreground">{a.gstin}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/agencies/${a.id}/edit`}>
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
