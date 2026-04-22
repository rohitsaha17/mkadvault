// Same handler as /auth/callback — Supabase's 2024+ default email
// templates point at /auth/confirm specifically.
import { AuthLinkHandler } from "@/components/auth/AuthLinkHandler";

export const metadata = { title: "Verifying your invite…" };

export default function AuthConfirmPage() {
  return <AuthLinkHandler />;
}
