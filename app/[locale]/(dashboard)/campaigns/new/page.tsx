import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm } from "@/components/campaigns/CampaignForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client, Site } from "@/lib/types/database";

export const metadata = { title: "New Campaign" };

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client_id?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { client_id } = await searchParams;

  const supabase = await createClient();

  const [{ data: clientsData }, { data: sitesData }] = await Promise.all([
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
  ]);

  const clients = (clientsData ?? []) as unknown as Pick<Client, "id" | "company_name" | "brand_name">[];
  const sites = (sitesData ?? []) as unknown as Pick<Site, "id" | "site_code" | "name" | "city" | "base_rate_paise" | "total_sqft" | "media_type">[];

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
        sites={sites}
        preselectedClientId={client_id}
      />
    </div>
  );
}
