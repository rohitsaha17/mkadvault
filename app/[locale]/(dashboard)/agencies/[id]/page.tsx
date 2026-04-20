import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { inr, fmt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, Phone, Mail, MapPin, FileText, Building2, Pencil, User, MapPinned,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { PartnerAgency, Contract, Site } from "@/lib/types/database";

export default async function AgencyDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const { data } = await supabase
    .from("partner_agencies")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!data) notFound();
  const agency = data as unknown as PartnerAgency;

  // Linked contracts
  const { data: contractsData } = await supabase
    .from("contracts")
    .select("*")
    .eq("agency_id", id)
    .is("deleted_at", null)
    .order("start_date", { ascending: false });
  const contracts = (contractsData ?? []) as unknown as Contract[];

  // Sites for contracts (include status and media_type for the Rented Sites section)
  const siteIds = [...new Set(contracts.map((c) => c.site_id))];
  let sites: (Pick<Site, "id" | "name" | "site_code" | "city"> & { status: string; media_type: string })[] = [];
  if (siteIds.length > 0) {
    const { data: sitesData } = await supabase
      .from("sites").select("id, name, site_code, city, status, media_type").in("id", siteIds);
    sites = (sitesData ?? []) as typeof sites;
  }
  const siteMap = new Map(sites.map((s) => [s.id, s]));

  const activeContracts = contracts.filter((c) => c.status === "active");

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/agencies"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Agencies
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {agency.agency_name}
          </h1>
          {agency.contact_person && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Contact: {agency.contact_person}
            </p>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">
            Added {fmt(agency.created_at)} · {activeContracts.length} active contract{activeContracts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/agencies/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">

          {/* Contact */}
          <Section title="Contact Information" icon={<User className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <DetailItem
                label="Phone"
                value={agency.phone}
                icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}
              />
              <DetailItem
                label="Email"
                value={agency.email}
                icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
              />
              <DetailItem label="GSTIN" value={agency.gstin} mono colSpan />
            </dl>
          </Section>

          {/* Address */}
          <Section title="Address" icon={<MapPin className="h-4 w-4" />}>
            <div className="space-y-0.5 text-sm text-foreground">
              {agency.address && <p>{agency.address}</p>}
              {(agency.city || agency.state) && (
                <p>{[agency.city, agency.state].filter(Boolean).join(", ")}</p>
              )}
              {!agency.address && !agency.city && !agency.state && (
                <p className="text-muted-foreground">No address on record</p>
              )}
            </div>
          </Section>

          {/* Rented Sites (derived from active contracts) */}
          <Section title="Rented Sites" icon={<MapPinned className="h-4 w-4" />}>
            {sites.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No sites linked via contracts yet.
              </p>
            ) : (
              <div className="divide-y divide-border -mx-1">
                {sites.map((s) => (
                  <Link
                    key={s.id}
                    href={`/sites/${s.id}`}
                    className="flex items-center justify-between gap-3 px-1 py-3 rounded-lg hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{s.site_code}</span> · {s.city} · {s.media_type.replace(/_/g, " ")}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* Notes */}
          {agency.notes && (
            <Section title="Notes" icon={<FileText className="h-4 w-4" />}>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {agency.notes}
              </p>
            </Section>
          )}
        </div>

        {/* Right: Contracts */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card card-elevated p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Linked Contracts</h3>
              <Link href={`/contracts/new?agency_id=${id}`}>
                <Button size="sm" variant="outline">+ New</Button>
              </Link>
            </div>

            {contracts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No contracts yet
              </p>
            ) : (
              <div className="space-y-3">
                {contracts.map((c) => {
                  const site = siteMap.get(c.site_id);
                  return (
                    <Link
                      key={c.id}
                      href={`/contracts/${c.id}`}
                      className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate text-foreground">{site?.name ?? c.site_id}</span>
                            {site?.site_code && (
                              <span className="font-mono text-muted-foreground">{site.site_code}</span>
                            )}
                          </div>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {fmt(c.start_date)} → {c.end_date ? fmt(c.end_date) : "Open-ended"}
                          </p>
                          {c.rent_amount_paise && (
                            <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                              {inr(c.rent_amount_paise)}
                              <span className="ml-1 text-xs font-normal text-muted-foreground">/ mo</span>
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-xs capitalize"
                        >
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DetailItem({
  label,
  value,
  icon,
  mono,
  colSpan,
}: {
  label: string;
  value: string | number | null | undefined;
  icon?: React.ReactNode;
  mono?: boolean;
  colSpan?: boolean;
}) {
  return (
    <div className={colSpan ? "col-span-2" : ""}>
      <dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className={`flex items-center gap-1.5 text-foreground ${mono ? "font-mono" : ""}`}>
        {value ? (
          <>
            {icon}
            {value}
          </>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}
