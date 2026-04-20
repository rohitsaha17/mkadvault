// Placeholder — will be implemented in a future sprint
import { setRequestLocale } from "next-intl/server";

export default async function AgingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="p-4 text-muted-foreground">Aging — coming soon</div>;
}
