import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { ProposalWizard } from "@/components/proposals/ProposalWizard";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client, Organization } from "@/lib/types/database";

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
    supabase
      .from("organizations")
      .select("name, address, city, state, pin_code, gstin, phone, email, logo_url")
      .eq("id", profile.org_id)
      .single(),
  ]);

  // Build photo map (site_id → full public URL).
  //
  // IMPORTANT: site_photos.photo_url stores a bucket-relative path
  // (e.g. "{org_id}/{site_id}/{ts}.jpg"). The PDF renderer
  // (@react-pdf/renderer) and the <img> preview both need a real URL.
  // Passing the raw path caused the PDF document to throw on mount, which
  // crashed Step 3 ("Preview & Export") with the generic "This page
  // couldn't load" error — particularly visible when generating the rate
  // card because it pre-selects every site (more images, more chances to
  // fail).
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
        org={org}
        preselectedSiteIds={preselectedSiteIds}
        isRateCard={mode === "rate_card"}
      />
    </div>
  );
}
