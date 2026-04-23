// Additional alias for custom email templates that point at
// /auth/verify. Same handler as /auth/callback and /auth/confirm —
// PKCE codes MUST be exchanged server-side.

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

export default async function AuthVerifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const result = await handleAuthLink(sp);
  if (result.kind !== "client") redirect(result.to);
  return <AuthLinkHandler />;
}
