import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
import { LandownerForm } from "@/components/landowners/LandownerForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Landowner } from "@/lib/types/database";

export const metadata = { title: "Edit Landowner" };

export default async function EditLandownerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from("landowners")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!data) notFound();
  const landowner = data as unknown as Landowner;

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/landowners/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {landowner.full_name}
      </Link>
      <PageHeader
        eyebrow="Partners"
        title="Edit Landowner"
        description={`Update ${landowner.full_name}'s details.`}
      />
      <LandownerForm existing={landowner} />
    </div>
  );
}
