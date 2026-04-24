import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { getSignedUrls } from "@/lib/supabase/signed-urls";
import { ProposalWizard } from "@/components/proposals/ProposalWizard";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client, Organization, PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "Create Proposal" };

// Site data passed to the wizard (includes primary photo)
export interface SiteForProposal {
  id: string;
  site_code: string;
  name: string;
  media_type: string;
  status: string;
  city: string;
  state: string;
  address: string;
  width_ft: number | null;
  height_ft: number | null;
  total_sqft: number | null;
  base_rate_paise: number | null;
  illumination: string | null;
  facing: string | null;
  visibility_distance_m: number | null;
  primary_photo_url: string | null;
}

export default async function NewProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { mode } = await searchParams;

  const supabase = await createClient();
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!profile?.org_id) redirect("/login");

  const [
    { data: sitesData },
    { data: photosData },
    { data: clientsData },
    { data: agenciesData },
    { data: orgData },
  ] = await Promise.all([
    supabase
      .from("sites")
      .select("id, site_code, name, media_type, status, city, state, address, width_ft, height_ft, total_sqft, base_rate_paise, illumination, facing, visibility_distance_m")
      .is("deleted_at", null)
      .order("city").order("name"),
    supabase
      .from("site_photos")
      .select("site_id, photo_url")
      .eq("is_primary", true),
    supabase
      .from("clients")
      .select("id, company_name")
      .is("deleted_at", null)
      .order("company_name"),
    // Partner agencies — valid recipients for a rate card / proposal
    // alongside direct clients. Migration 039 added proposals.agency_id.
    supabase
      .from("partner_agencies")
      .select("id, agency_name")
      .is("deleted_at", null)
      .order("agency_name"),
    supabase
      .from("organizations")
      .select("name, address, city, state, pin_code, gstin, phone, email, logo_url")
      .eq("id", profile.org_id)
      .single(),
  ]);

  // Build photo map (site_id → signed URL).
  //
  // site_photos.photo_url stores a bucket-relative path like
  // "{org_id}/{site_id}/{ts}.jpg". The `site-photos` bucket is PRIVATE
  // (see migration 023), so we can't use the public-URL constructor —
  // those requests 403. We mint short-lived signed URLs here so the
  // preview `<img>` and the @react-pdf/renderer document can load them.
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
  const agencies = (agenciesData ?? []) as Pick<PartnerAgency, "id" | "agency_name">[];
  const orgRaw = orgData as
    | (Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "phone" | "email">
        & { logo_url?: string | null })
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
  // Fetch the rate-card T&C template in an isolated query so a missing
  // migration 040 (new column) or 026 (legacy column) can't null out
  // the whole org record and break this page. Swallows 42703 / PGRST204.
  const orgTermsTemplate: string | null = await (async () => {
    const { data, error } = await supabase
      .from("organizations")
      .select("rate_card_terms_template")
      .eq("id", profile.org_id)
      .maybeSingle();
    if (!error && data) {
      return (data as { rate_card_terms_template?: string | null }).rate_card_terms_template ?? null;
    }
    const { data: legacy } = await supabase
      .from("organizations")
      .select("proposal_terms_template")
      .eq("id", profile.org_id)
      .maybeSingle();
    return (legacy as { proposal_terms_template?: string | null } | null)
      ?.proposal_terms_template ?? null;
  })();

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

  // Rate card mode: pre-select all available sites
  const preselectedSiteIds = mode === "rate_card"
    ? sites.filter((s) => s.status === "available").map((s) => s.id)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Revenue"
        title={mode === "rate_card" ? "Export Rate Card" : "Create Proposal"}
        description={
          mode === "rate_card"
            ? "Generate a rate card for all available sites."
            : "Build a professional proposal to share with your client."
        }
      />
      <ProposalWizard
        sites={sites}
        clients={clients}
        agencies={agencies}
        org={org}
        orgLogoUrl={orgLogoUrl}
        orgTermsTemplate={orgTermsTemplate}
        preselectedSiteIds={preselectedSiteIds}
        isRateCard={mode === "rate_card"}
      />
    </div>
  );
}
