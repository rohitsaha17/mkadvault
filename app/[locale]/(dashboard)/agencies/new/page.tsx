import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AgencyForm } from "@/components/agencies/AgencyForm";
import { PageHeader } from "@/components/shared/PageHeader";

export const metadata = { title: "Add Agency" };

export default async function NewAgencyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/agencies"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Agencies
      </Link>
      <PageHeader
        eyebrow="Partners"
        title="Add Partner Agency"
        description="Enter the agency details including contact and address information."
      />
      <AgencyForm />
    </div>
  );
}
