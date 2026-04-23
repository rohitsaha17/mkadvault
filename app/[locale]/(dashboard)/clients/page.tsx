// Clients list — themed to match the app-wide UI overhaul.
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
import { Plus, Search, Phone, Mail, Pencil, Briefcase } from "lucide-react";
import { ListExportMenu } from "@/components/shared/ListExportMenu";
import { sanitizeSearch } from "@/lib/utils";
import type { Client } from "@/lib/types/database";

export const metadata = { title: "Clients" };

const PAGE_SIZE = 20;

const TERMS_LABELS: Record<string, string> = {
  advance: "Advance",
  net15: "Net 15",
  net30: "Net 30",
  net60: "Net 60",
};

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; terms?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("clients");

  const { q, terms, page, sort, dir } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Validate sort column against allowlist to prevent injection
  const SORTABLE_COLUMNS = ["company_name", "credit_terms", "primary_contact_name"] as const;
  const sortCol = SORTABLE_COLUMNS.includes(sort as (typeof SORTABLE_COLUMNS)[number])
    ? (sort as string)
    : "company_name";
  const sortDir: "asc" | "desc" = dir === "desc" ? "desc" : "asc";

  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order(sortCol, { ascending: sortDir === "asc" });

  if (q) {
    const safe = sanitizeSearch(q);
    query = query.or(
      `company_name.ilike.%${safe}%,brand_name.ilike.%${safe}%,primary_contact_name.ilike.%${safe}%,primary_contact_email.ilike.%${safe}%`
    );
  }
  if (terms) query = query.eq("credit_terms", terms);

  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  const clients = (data ?? []) as unknown as Client[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!(q || terms);

  const buildHref = (extra: Record<string, string>) => {
    const p: Record<string, string> = {};
    if (q) p.q = q;
    if (terms) p.terms = terms;
    if (sort) p.sort = sort;
    if (dir) p.dir = dir;
    return `/clients?${new URLSearchParams({ ...p, ...extra })}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ListExportMenu entityType="clients" data={clients as unknown as Record<string, unknown>[]} filenameBase="clients" />
            <Link href="/clients/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Client
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
            placeholder="Search by name, brand, contact…"
            className="pl-9"
          />
        </div>
        <select
          name="terms"
          defaultValue={terms ?? ""}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 w-36"
        >
          <option value="">All Terms</option>
          <option value="advance">Advance</option>
          <option value="net15">Net 15</option>
          <option value="net30">Net 30</option>
          <option value="net60">Net 60</option>
        </select>
        <Button type="submit" variant="outline" size="sm">Search</Button>
        {hasFilters && (
          <Link href="/clients">
            <Button variant="ghost" size="sm">Clear</Button>
          </Link>
        )}
      </form>

      {total > 0 && (
        <p className="text-xs text-muted-foreground mb-3 tabular-nums">
          Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} client{total !== 1 ? "s" : ""}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load clients: {error.message}
        </div>
      )}

      {!error && clients.length === 0 && (
        <EmptyState
          variant="card"
          icon={<Briefcase className="h-7 w-7" />}
          title={hasFilters ? t("noClientsFiltered") : t("noClients")}
          description={
            hasFilters
              ? t("noClientsFilteredDesc")
              : t("noClientsDesc")
          }
          action={
            hasFilters ? (
              <Link href="/clients">
                <Button variant="outline" size="sm">Clear all filters</Button>
              </Link>
            ) : (
              <Link href="/clients/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Add Client
                </Button>
              </Link>
            )
          }
        />
      )}

      {!error && clients.length > 0 && (
        <>
          <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="company_name" label="Company / Brand" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <TableHead>Primary Contact</TableHead>
                  <SortableTableHead column="credit_terms" label="Credit Terms" currentSort={sort ?? null} currentDir={(dir as "asc" | "desc") ?? null} />
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/clients/${c.id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {c.company_name}
                      </Link>
                      {c.brand_name && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{c.brand_name}</p>
                      )}
                      {c.industry_category && (
                        <p className="text-[11px] text-muted-foreground/70">{c.industry_category}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="space-y-0.5">
                        {c.primary_contact_name && (
                          <p className="text-xs font-medium text-foreground">
                            {c.primary_contact_name}
                          </p>
                        )}
                        {c.primary_contact_phone && (
                          <div className="flex items-center gap-1.5 text-xs tabular-nums">
                            <Phone className="h-3 w-3 shrink-0" />
                            {c.primary_contact_phone}
                          </div>
                        )}
                        {c.primary_contact_email && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Mail className="h-3 w-3 shrink-0" />
                            {c.primary_contact_email}
                          </div>
                        )}
                        {!c.primary_contact_name &&
                          !c.primary_contact_phone &&
                          !c.primary_contact_email && (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {TERMS_LABELS[c.credit_terms] ?? c.credit_terms}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/clients/${c.id}/edit`}>
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
