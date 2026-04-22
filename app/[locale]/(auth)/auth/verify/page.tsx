// Additional alias for custom email templates that point at
// /auth/verify. Same handler as /auth/callback and /auth/confirm.
import { AuthLinkHandler } from "@/components/auth/AuthLinkHandler";

export const metadata = { title: "Verifying your invite…" };

export default function AuthVerifyPage() {
  return <AuthLinkHandler />;
}
