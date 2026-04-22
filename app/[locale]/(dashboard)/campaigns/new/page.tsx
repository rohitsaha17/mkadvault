import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client, Site, PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "New Campaign" };

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  // site_id: prefilled when launched from a site detail page. We additionally
  // fetch that specific site and merge it into the available-sites list so it
  // can be pre-added to the booking even if its current status isn't
  // "available" (e.g. the user wants to overlap/replace an existing booking).
  searchParams: Promise<{ client_id?: string; site_id?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { client_id, site_id } = await searchParams;

  const supabase = await createClient();

  const [
    { data: clientsData },
    { data: sitesData },
    { data: preselectedSiteData },
    { data: agenciesData },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, brand_name")
      .is("deleted_at", null)
      .order("company_name"),
    supabase
      .from("sites")
      .select("id, site_code, name, city, base_rate_paise, total_sqft, media_type")
      .eq("status", "available")
      .is("deleted_at", null)
      .order("name"),
    site_id
      ? supabase
          .from("sites")
          .select("id, site_code, name, city, base_rate_paise, total_sqft, media_type")
          .eq("id", site_id)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Partner agencies — used by the Bill To selector so users can pick
    // which agency is billed (or earns a commission) on this campaign.
    supabase
      .from("partner_agencies")
      .select("id, agency_name")
      .is("deleted_at", null)
      .order("agency_name"),
  ]);

  const clients = (clientsData ?? []) as unknown as Pick<Client, "id" | "company_name" | "brand_name">[];
  const agencies = (agenciesData ?? []) as unknown as Pick<PartnerAgency, "id" | "agency_name">[];
  const availableSites = (sitesData ?? []) as unknown as Pick<Site, "id" | "site_code" | "name" | "city" | "base_rate_paise" | "total_sqft" | "media_type">[];
  const preselectedSite = preselectedSiteData as unknown as
    Pick<Site, "id" | "site_code" | "name" | "city" | "base_rate_paise" | "total_sqft" | "media_type">
    | null;

  // Merge the preselected site into the list if it's not already there (e.g.
  // its status is "booked" but we still want to allow pre-adding it).
  const sites = preselectedSite && !availableSites.some((s) => s.id === preselectedSite.id)
    ? [preselectedSite, ...availableSites]
    : availableSites;

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Campaigns
      </Link>
      <PageHeader
        eyebrow="Revenue"
        title="New Campaign"
        description="Create a new advertising campaign."
      />
      <CampaignForm
        clients={clients}
        agencies={agencies}
        sites={sites}
        preselectedClientId={client_id}
        preselectedSiteId={preselectedSite?.id}
      />
    </div>
  );
}
