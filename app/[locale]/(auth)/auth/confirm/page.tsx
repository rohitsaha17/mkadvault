// Same handler as /auth/callback — Supabase's 2024+ default email
// templates point at /auth/confirm specifically. PKCE codes MUST be
// exchanged server-side (see lib/auth/handleAuthLink.ts for why).

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

export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const result = await handleAuthLink(sp);
  if (result.kind !== "client") redirect(result.to);
  return <AuthLinkHandler />;
}
