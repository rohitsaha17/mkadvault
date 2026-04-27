// Root dashboard route — redirects to /[locale]/dashboard. We pass
// the locale explicitly so the redirect doesn't rely on next-intl's
// middleware re-running over a partial path; bare /dashboard is
// theoretically rewritten by the middleware but a defensive prefix
// removes any ordering risk on cold starts.

import { redirect } from "next/navigation";

export default async function DashboardRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard`);
}
