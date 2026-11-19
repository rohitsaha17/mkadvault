import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CampaignEditForm, type ExistingSite, type ExistingService } from "@/components/campaigns/CampaignEditForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Campaign, Client, PartnerAgency, Site } from "@/lib/types/database";

export const metadata = { title: "Edit Campaign" };

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Pull everything the edit form needs in one round-trip. The sites
  // list is "available + already on this campaign" so the user can
  // swap sites in without losing the ones currently booked (which are
  // status=booked and would otherwise be filtered out).
  const [
    { data: campData },
    { data: clientsData },
    { data: agenciesData },
    { data: campSitesData },
    { data: campServicesData },
    { data: availableSitesData },
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("clients")
      .select("id, company_name, brand_name")
      .is("deleted_at", null)
      .order("company_name"),
    supabase
      .from("partner_agencies")
      .select("id, agency_name")
      .is("deleted_at", null)
      .order("agency_name"),
    supabase
      .from("campaign_sites")
      .select("id, site_id, rate_type, display_rate_paise, start_date, end_date, site:sites(id, site_code, name, city, base_rate_paise, total_sqft, media_type)")
      .eq("campaign_id", id),
    supabase
      .from("campaign_services")
      .select("id, service_type, description, quantity, rate_paise, site_id, rate_basis, other_label")
      .eq("campaign_id", id),
    supabase
      .from("sites")
      .select("id, site_code, name, city, base_rate_paise, total_sqft, media_type")
      .eq("status", "available")
      .is("deleted_at", null)
      .order("name"),
  ]);

  if (!campData) notFound();

  const campaign = campData as unknown as Campaign;
  const clients = (clientsData ?? []) as unknown as Pick<Client, "id" | "company_name" | "brand_name">[];
  const agencies = (agenciesData ?? []) as unknown as Pick<PartnerAgency, "id" | "agency_name">[];

  // Normalise the Postgrest to-one join (`site`) which comes back as
  // either an object or an array depending on the client version.
  type SiteMini = Pick<Site, "id" | "site_code" | "name" | "city" | "base_rate_paise" | "total_sqft" | "media_type">;
  const pickSite = (raw: SiteMini | SiteMini[] | null | undefined): SiteMini | null => {
    if (!raw) return null;
    return Array.isArray(raw) ? raw[0] ?? null : raw;
  };

  const existingSites: ExistingSite[] = ((campSitesData ?? []) as Array<{
    id: string;
    site_id: string;
    rate_type: string | null;
    display_rate_paise: number | null;
    start_date: string | null;
    end_date: string | null;
    site: SiteMini | SiteMini[] | null;
  }>).map((cs) => {
    const site = pickSite(cs.site);
    return {
      id: cs.id,
      site_id: cs.site_id,
      rate_type: (cs.rate_type as "per_month" | "fixed" | null) ?? "per_month",
      display_rate_inr:
        cs.display_rate_paise != null ? cs.display_rate_paise / 100 : undefined,
      start_date: cs.start_date ?? undefined,
      end_date: cs.end_date ?? undefined,
      // Carry site meta so the edit form can show name/code without
      // another lookup.
      site_name: site?.name ?? "",
      site_code: site?.site_code ?? "",
      city: site?.city ?? "",
      media_type: site?.media_type ?? "",
      total_sqft: site?.total_sqft ?? null,
    };
  });

  const existingServices: ExistingService[] = ((campServicesData ?? []) as Array<{
    id: string;
    service_type: string;
    description: string | null;
    quantity: number;
    rate_paise: number | null;
    site_id: string | null;
    rate_basis: string | null;
    other_label: string | null;
  }>).map((sv) => ({
    id: sv.id,
    service_type: sv.service_type as ExistingService["service_type"],
    description: sv.description ?? "",
    quantity: sv.quantity,
    rate_inr: sv.rate_paise != null ? sv.rate_paise / 100 : 0,
    site_id: sv.site_id ?? undefined,
    rate_basis:
      (sv.rate_basis as "per_sqft" | "lumpsum" | "other" | null) ?? "lumpsum",
    other_label: sv.other_label ?? "",
  }));

  // Union: sites currently on this campaign + sites currently
  // available. De-dupe by id so a currently-booked-but-already-on-this-
  // campaign site shows up exactly once.
  const availableSites = (availableSitesData ?? []) as unknown as SiteMini[];
  const onCampaignSiteIds = new Set(existingSites.map((s) => s.site_id));
  const extra = existingSites
    .filter((s) => !availableSites.some((a) => a.id === s.site_id))
    .map((s) => ({
      id: s.site_id,
      site_code: s.site_code,
      name: s.site_name,
      city: s.city,
      base_rate_paise: null,
      total_sqft: s.total_sqft,
      // DB stores media_type as one of the MediaType enum values; the
      // join on `existingSites` carried it in as `string`, cast back.
      media_type: s.media_type as SiteMini["media_type"],
    })) satisfies SiteMini[];
  const sitePickerSites: SiteMini[] = [
    ...availableSites.filter((a) => !onCampaignSiteIds.has(a.id)),
    ...extra,
    ...availableSites.filter((a) => onCampaignSiteIds.has(a.id)),
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href={`/campaigns/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {campaign.campaign_name}
      </Link>
      <PageHeader
        eyebrow="Revenue"
        title="Edit Campaign"
        description="Update basics, sites and services. Site edits preserve mounting photos and creative uploads."
      />
      <CampaignEditForm
        existing={campaign}
        clients={clients}
        agencies={agencies}
        pickerSites={sitePickerSites}
        existingSites={existingSites}
        existingServices={existingServices}
      />
    </div>
  );
}
