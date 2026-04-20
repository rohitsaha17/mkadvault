import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
import { AgencyForm } from "@/components/agencies/AgencyForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "Edit Agency" };

export default async function EditAgencyPage({
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

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/agencies/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {agency.agency_name}
      </Link>
      <PageHeader
        eyebrow="Partners"
        title="Edit Agency"
        description={`Update ${agency.agency_name}'s details.`}
      />
      <AgencyForm existing={agency} />
    </div>
  );
}
