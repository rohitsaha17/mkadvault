// New Site page — renders the multi-step SiteForm with no pre-filled data.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SiteForm } from "@/components/sites/SiteForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { createClient } from "@/lib/supabase/server";

export default async function NewSitePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Fetch landowners (owned sites) + partner agencies (sublet sites) for
  // the commercial step pickers. RLS scopes both to the current org.
  const supabase = await createClient();
  const [landownersRes, agenciesRes] = await Promise.all([
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
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/sites"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Sites
      </Link>
      <PageHeader
        eyebrow="Inventory"
        title="Add New Site"
        description="Fill in the details below. Photos can be added after saving."
      />
      <SiteForm
        landowners={landownersRes.data ?? []}
        agencies={agenciesRes.data ?? []}
      />
    </div>
  );
}
