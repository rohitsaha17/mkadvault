import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
import { ContractForm } from "@/components/contracts/ContractForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Contract, Site, Landowner, PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "Edit Contract" };

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const [{ data: cData }, { data: sitesData }, { data: lData }, { data: aData }] = await Promise.all([
    supabase.from("contracts").select("*").eq("id", id).is("deleted_at", null).single(),
    supabase.from("sites").select("id, name, site_code, city").is("deleted_at", null).order("name"),
    supabase.from("landowners").select("id, full_name, phone").is("deleted_at", null).order("full_name"),
    supabase.from("partner_agencies").select("id, agency_name").is("deleted_at", null).order("agency_name"),
  ]);

  if (!cData) notFound();
  const contract = cData as unknown as Contract;
  const sites = (sitesData ?? []) as unknown as Pick<Site, "id" | "name" | "site_code" | "city">[];
  const landowners = (lData ?? []) as unknown as Pick<Landowner, "id" | "full_name" | "phone">[];
  const agencies = (aData ?? []) as unknown as Pick<PartnerAgency, "id" | "agency_name">[];

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/contracts/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Contract
      </Link>
      <PageHeader
        eyebrow="Inventory"
        title="Edit Contract"
        description="Update contract terms. Note: editing does not regenerate the payment schedule."
      />
      <ContractForm existing={contract} sites={sites} landowners={landowners} agencies={agencies} />
    </div>
  );
}
