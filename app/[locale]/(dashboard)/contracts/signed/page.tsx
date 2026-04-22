// Standalone signed agreements — scanned copies of executed documents that
// aren't tied to a full contract record (MoUs, NDAs, legacy paper contracts,
// etc.). Admins can upload via the dialog and view / soft-delete records here.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft, FileSignature } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { SignedAgreementUploadDialog } from "@/components/contracts/SignedAgreementUploadDialog";
import { SignedAgreementRow } from "@/components/contracts/SignedAgreementRow";
import type {
  SignedAgreement,
  Landowner,
  PartnerAgency,
  Client,
  Site,
} from "@/lib/types/database";

export const metadata = { title: "Signed agreements" };

export default async function SignedAgreementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Load the agreements + lookups for the upload dialog in parallel.
  const [agreementsResult, landownersResult, agenciesResult, clientsResult, sitesResult] =
    await Promise.all([
      supabase
        .from("signed_agreements")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("landowners")
        .select("id, full_name")
        .is("deleted_at", null)
        .order("full_name"),
      supabase
        .from("partner_agencies")
        .select("id, agency_name")
        .is("deleted_at", null)
        .order("agency_name"),
      supabase
        .from("clients")
        .select("id, company_name")
        .is("deleted_at", null)
        .order("company_name"),
      supabase
        .from("sites")
        .select("id, name, site_code")
        .is("deleted_at", null)
        .order("name"),
    ]);

  const agreements = (agreementsResult.data ?? []) as unknown as SignedAgreement[];
  const landowners = (landownersResult.data ?? []) as unknown as Pick<Landowner, "id" | "full_name">[];
  const agencies = (agenciesResult.data ?? []) as unknown as Pick<PartnerAgency, "id" | "agency_name">[];
  const clients = (clientsResult.data ?? []) as unknown as Pick<Client, "id" | "company_name">[];
  const sites = (sitesResult.data ?? []) as unknown as Pick<Site, "id" | "name" | "site_code">[];

  // Build quick-lookup maps so we can show the counterparty name without
  // another round-trip.
  const landownerMap = new Map(landowners.map((l) => [l.id, l.full_name]));
  const agencyMap = new Map(agencies.map((a) => [a.id, a.agency_name]));
  const clientMap = new Map(clients.map((c) => [c.id, c.company_name]));
  const siteMap = new Map(sites.map((s) => [s.id, s]));

  function subtitleFor(a: SignedAgreement): string {
    const parts: string[] = [];
    if (a.counterparty_type) {
      const label =
        a.counterparty_type.charAt(0).toUpperCase() + a.counterparty_type.slice(1);
      parts.push(label);
    }
    const partyName =
      (a.landowner_id && landownerMap.get(a.landowner_id)) ||
      (a.agency_id && agencyMap.get(a.agency_id)) ||
      (a.client_id && clientMap.get(a.client_id)) ||
      null;
    if (partyName) parts.push(partyName);
    if (a.site_id) {
      const s = siteMap.get(a.site_id);
      if (s) parts.push(`Site: ${s.name}`);
    }
    return parts.join(" · ");
  }

  return (
    <div>
      <Link
        href={`/${locale}/contracts`}
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Contracts
      </Link>

      <PageHeader
        eyebrow="Contracts"
        title="Signed agreements"
        description="Scanned signed documents that don't live inside a full contract record."
        actions={
          <SignedAgreementUploadDialog
            landowners={landowners}
            agencies={agencies}
            clients={clients}
            sites={sites}
          />
        }
      />

      {agreements.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<FileSignature className="h-7 w-7" />}
          title="No signed agreements yet"
          description="Upload a scanned signed copy — we'll keep it here for easy retrieval."
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card card-elevated">
          <div className="divide-y divide-border">
            {agreements.map((a) => (
              <SignedAgreementRow
                key={a.id}
                id={a.id}
                title={a.title}
                subtitle={subtitleFor(a)}
                agreementDate={a.agreement_date}
                documentUrl={a.document_url}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
