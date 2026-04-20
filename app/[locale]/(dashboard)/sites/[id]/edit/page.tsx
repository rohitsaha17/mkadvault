// Edit Site page — fetches the existing site from Supabase and passes it to
// SiteForm as `existingSite` so all fields are pre-populated.
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteForm } from "@/components/sites/SiteForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Site } from "@/lib/types/database";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditSitePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const [siteResult, landownersResult] = await Promise.all([
    supabase
      .from("sites")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("landowners")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name"),
  ]);

  if (siteResult.error || !siteResult.data) notFound();
  const site = siteResult.data as unknown as Site;
  const landowners = landownersResult.data ?? [];

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href={`/sites/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Site
      </Link>
      <PageHeader
        eyebrow="Inventory"
        title="Edit Site"
        description={`${site.name} · ${site.site_code}`}
      />
      <SiteForm existingSite={site} landowners={landowners} />
    </div>
  );
}
