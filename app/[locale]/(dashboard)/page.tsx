// Root dashboard route — redirects to /[locale]/dashboard
// The actual full dashboard implementation lives in /dashboard/page.tsx.

import { redirect } from "next/navigation";

export default function DashboardRootPage() {
  redirect("/dashboard");
}
