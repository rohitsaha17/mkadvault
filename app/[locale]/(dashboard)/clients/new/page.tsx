import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ClientForm } from "@/components/clients/ClientForm";
import { PageHeader } from "@/components/shared/PageHeader";

export const metadata = { title: "Add Client" };

export default async function NewClientPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Clients
      </Link>
      <PageHeader
        eyebrow="Revenue"
        title="Add Client"
        description="Enter the client's company details, contacts, and billing information."
      />
      <ClientForm />
    </div>
  );
}
