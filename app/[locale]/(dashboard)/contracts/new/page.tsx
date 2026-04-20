import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ContractForm } from "@/components/contracts/ContractForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Site, Landowner, PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "New Contract" };

export default async function NewContractPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const [{ data: sitesData }, { data: lData }, { data: aData }] = await Promise.all([
    supabase.from("sites").select("id, name, site_code, city").is("deleted_at", null).order("name"),
    supabase.from("landowners").select("id, full_name, phone").is("deleted_at", null).order("full_name"),
    supabase.from("partner_agencies").select("id, agency_name").is("deleted_at", null).order("agency_name"),
  ]);

  const sites = (sitesData ?? []) as unknown as Pick<Site, "id" | "name" | "site_code" | "city">[];
  const landowners = (lData ?? []) as unknown as Pick<Landowner, "id" | "full_name" | "phone">[];
  const agencies = (aData ?? []) as unknown as Pick<PartnerAgency, "id" | "agency_name">[];

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/contracts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Contracts
      </Link>
      <PageHeader
        eyebrow="Inventory"
        title="New Contract"
        description="Set up a contract with a landowner or agency. A payment schedule will be auto-generated."
      />
      <ContractForm sites={sites} landowners={landowners} agencies={agencies} />
    </div>
  );
}
