import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { ProposalWizard } from "@/components/proposals/ProposalWizard";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client, Organization, Proposal, ProposalSite } from "@/lib/types/database";
import type { SiteForProposal } from "../../new/page";

export const metadata = { title: "Edit Proposal" };

export default async function EditProposalPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!profile?.org_id) redirect("/login");

  const [
    { data: proposalData },
    { data: proposalSitesData },
    { data: sitesData },
    { data: photosData },
    { data: clientsData },
    { data: orgData },
  ] = await Promise.all([
    supabase.from("proposals").select("*").eq("id", id).is("deleted_at", null).single(),
    supabase.from("proposal_sites").select("*").eq("proposal_id", id).order("display_order"),
    supabase.from("sites").select("id, site_code, name, media_type, status, city, state, address, width_ft, height_ft, total_sqft, base_rate_paise, illumination, facing, visibility_distance_m").is("deleted_at", null).order("city").order("name"),
    supabase.from("site_photos").select("site_id, photo_url").eq("is_primary", true),
    supabase.from("clients").select("id, company_name").is("deleted_at", null).order("company_name"),
    supabase.from("organizations").select("name, address, city, state, pin_code, gstin, phone, email, logo_url").eq("id", profile.org_id).single(),
  ]);

  if (!proposalData) notFound();

  const proposal = proposalData as unknown as Proposal;
  const existingSites = (proposalSitesData ?? []) as unknown as ProposalSite[];

  // Convert bucket-relative paths to full public URLs so the PDF renderer
  // and <img> previews can load them. See proposals/new/page.tsx for the
  // full rationale (same fix).
  const storagePublicBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-photos`;
  const photoMap = new Map<string, string>();
  for (const p of photosData ?? []) {
    const isAlreadyUrl = /^https?:\/\//i.test(p.photo_url);
    photoMap.set(p.site_id, isAlreadyUrl ? p.photo_url : `${storagePublicBase}/${p.photo_url}`);
  }

  const sites: SiteForProposal[] = (sitesData ?? []).map((s) => ({
    id: s.id,
    site_code: s.site_code,
    name: s.name,
    media_type: s.media_type,
    status: s.status,
    city: s.city,
    state: s.state,
    address: s.address,
    width_ft: s.width_ft,
    height_ft: s.height_ft,
    total_sqft: s.total_sqft,
    base_rate_paise: s.base_rate_paise,
    illumination: s.illumination,
    facing: s.facing,
    visibility_distance_m: s.visibility_distance_m,
    primary_photo_url: photoMap.get(s.id) ?? null,
  }));

  const clients = (clientsData ?? []) as Pick<Client, "id" | "company_name">[];
  const org = orgData as (Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "phone" | "email"> & { logo_url?: string | null }) | null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Revenue"
        title="Edit Proposal"
        description={`Editing: ${proposal.proposal_name}`}
      />
      <ProposalWizard
        sites={sites}
        clients={clients}
        org={org}
        existingProposal={proposal}
        existingSites={existingSites}
        editProposalId={id}
      />
    </div>
  );
}
