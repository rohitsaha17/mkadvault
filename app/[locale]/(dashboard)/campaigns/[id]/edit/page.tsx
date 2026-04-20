import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CampaignEditForm } from "@/components/campaigns/CampaignEditForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Campaign, Client } from "@/lib/types/database";

export const metadata = { title: "Edit Campaign" };

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const [{ data: campData }, { data: clientsData }] = await Promise.all([
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
  ]);

  if (!campData) notFound();

  const campaign = campData as unknown as Campaign;
  const clients = (clientsData ?? []) as unknown as Pick<Client, "id" | "company_name" | "brand_name">[];

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
        description="Update campaign basics. To add/remove sites, use the campaign detail page."
      />
      <CampaignEditForm existing={campaign} clients={clients} />
    </div>
  );
}
