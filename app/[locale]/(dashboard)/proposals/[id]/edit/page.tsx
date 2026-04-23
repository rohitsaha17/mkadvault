import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { getSignedUrls } from "@/lib/supabase/signed-urls";
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
    supabase.from("organizations").select("name, address, city, state, pin_code, gstin, phone, email, logo_url, proposal_terms_template").eq("id", profile.org_id).single(),
  ]);

  if (!proposalData) notFound();

  const proposal = proposalData as unknown as Proposal;
  const existingSites = (proposalSitesData ?? []) as unknown as ProposalSite[];

  // `site-photos` bucket is private — use signed URLs so the preview and
  // PDF renderer can actually load them. See proposals/new/page.tsx for
  // the same fix.
  const paths = (photosData ?? [])
    .map((p) => p.photo_url)
    .filter((u): u is string => !!u && !/^https?:\/\//i.test(u));
  const signedMap = await getSignedUrls("site-photos", paths);
  const photoMap = new Map<string, string>();
  for (const p of photosData ?? []) {
    const isAlreadyUrl = /^https?:\/\//i.test(p.photo_url);
    const resolved = isAlreadyUrl ? p.photo_url : signedMap[p.photo_url];
    if (resolved) photoMap.set(p.site_id, resolved);
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
  const orgRaw = orgData as
    | (Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "phone" | "email">
        & { logo_url?: string | null; proposal_terms_template?: string | null })
    | null;
  const org = orgRaw
    ? {
        name: orgRaw.name,
        address: orgRaw.address,
        city: orgRaw.city,
        state: orgRaw.state,
        pin_code: orgRaw.pin_code,
        gstin: orgRaw.gstin,
        phone: orgRaw.phone,
        email: orgRaw.email,
        logo_url: orgRaw.logo_url ?? null,
      }
    : null;
  const orgTermsTemplate = orgRaw?.proposal_terms_template ?? null;

  // Sign the org logo so the PPTX export can embed its bytes into the
  // generated deck. Short TTL is fine — generation happens shortly
  // after the user lands on this page.
  let orgLogoUrl: string | null = null;
  if (orgRaw?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("org-logos")
      .createSignedUrl(orgRaw.logo_url, 60 * 60);
    orgLogoUrl = signed?.signedUrl ?? null;
  }

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
        orgLogoUrl={orgLogoUrl}
        orgTermsTemplate={orgTermsTemplate}
        existingProposal={proposal}
        existingSites={existingSites}
        editProposalId={id}
      />
    </div>
  );
}
