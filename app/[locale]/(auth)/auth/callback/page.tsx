// Auth callback — entry point Supabase redirects users to after an
// invite / magic-link / password-reset / email-confirm link is
// clicked. See lib/auth/handleAuthLink.ts for the full flow story;
// this file just wires the search params to the shared helper.

import { redirect } from "next/navigation";
import { AuthLinkHandler } from "@/components/auth/AuthLinkHandler";
import { handleAuthLink } from "@/lib/auth/handleAuthLink";

export const metadata = { title: "Verifying…" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  code?: string;
  next?: string;
  type?: string;
}>;

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const result = await handleAuthLink(sp);
  if (result.kind !== "client") redirect(result.to);
  return <AuthLinkHandler />;
}
