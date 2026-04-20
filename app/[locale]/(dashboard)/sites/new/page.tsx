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

  // Fetch landowners for the commercial step's picker. RLS scopes to org.
  const supabase = await createClient();
  const { data: landowners } = await supabase
    .from("landowners")
    .select("id, full_name")
    .is("deleted_at", null)
    .order("full_name");

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
      <SiteForm landowners={landowners ?? []} />
    </div>
  );
}
