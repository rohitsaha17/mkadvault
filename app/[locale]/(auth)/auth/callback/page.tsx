// Auth callback — entry point Supabase redirects users to after an
// invite / magic-link / password-reset / email-confirm link is
// clicked. All the real work lives in the AuthLinkHandler client
// component so we can also read URL fragments (which carry tokens
// in Supabase's implicit flow and never reach the server). Three
// routes — /auth/callback, /auth/confirm, /auth/verify — all render
// this same component so every email-template URL shape works.
import { AuthLinkHandler } from "@/components/auth/AuthLinkHandler";

export const metadata = { title: "Verifying your invite…" };

export default function AuthCallbackPage() {
  return <AuthLinkHandler />;
}
