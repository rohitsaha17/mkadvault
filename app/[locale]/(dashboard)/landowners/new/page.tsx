import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { LandownerForm } from "@/components/landowners/LandownerForm";
import { PageHeader } from "@/components/shared/PageHeader";

export const metadata = { title: "Add Landowner" };

export default async function NewLandownerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/landowners"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Landowners
      </Link>
      <PageHeader
        eyebrow="Partners"
        title="Add Landowner"
        description="Enter the landowner's details. Bank and tax fields are sensitive and visible only to authorised roles."
      />
      <LandownerForm />
    </div>
  );
}
