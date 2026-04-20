import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ClientForm } from "@/components/clients/ClientForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client } from "@/lib/types/database";

export const metadata = { title: "Edit Client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from("clients").select("*").eq("id", id).is("deleted_at", null).single();

  if (!data) notFound();
  const client = data as unknown as Client;

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={`/clients/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to {client.company_name}
      </Link>
      <PageHeader
        eyebrow="Revenue"
        title="Edit Client"
        description={`Update ${client.company_name}'s details.`}
      />
      <ClientForm existing={client} />
    </div>
  );
}
