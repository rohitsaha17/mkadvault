// Shared server-side handler for the Supabase email-link landing pages.
// Supabase's `/auth/callback`, `/auth/confirm`, and `/auth/verify`
// pages all need the same logic: if the link carries a PKCE `code`,
// exchange it server-side (where the httpOnly verifier cookie is
// readable); otherwise fall through to the client handler for the
// implicit / OTP / hash-error cases.
//
// Called from Server Components. Either returns a destination string
// to redirect to, or null meaning "render the client handler".

import { createClient } from "@/lib/supabase/server";

type ResolvedSearchParams = {
  code?: string;
  next?: string;
  type?: string;
};

export type AuthLinkResult =
  | { kind: "redirect"; to: string }
  | { kind: "error"; to: string }
  | { kind: "client" };

export async function handleAuthLink(
  sp: ResolvedSearchParams,
): Promise<AuthLinkResult> {
  const code = sp.code;
  const nextParam = sp.next;
  const type = sp.type;

  if (!code) {
    // No PKCE code — the link is probably an OTP or implicit flow.
    // The client handler reads window.location.hash and window.location.search
    // to drive verifyOtp() / setSession() as appropriate.
    return { kind: "client" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Common causes: expired code, tampered URL, or the httpOnly
    // verifier cookie was cleared (user clicked the link in a
    // different browser profile / private window). Surface the real
    // message via the login page's ?error query param.
    const qs = new URLSearchParams({
      error: `Invite link problem: ${error.message}`,
    });
    return { kind: "error", to: `/login?${qs.toString()}` };
  }

  // Decide where to send them next.
  //   - Invitee that still needs to set a password → /accept-invite.
  //   - Recovery (?type=recovery or forgotPasswordAction's ?next=/reset-password)
  //     → /reset-password (or the explicit ?next= if provided).
  //   - Otherwise → ?next= or /dashboard.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const needsPasswordSetup =
    user?.user_metadata?.needs_password_setup === true;
  const isRecovery = type === "recovery";

  if (needsPasswordSetup) {
    return { kind: "redirect", to: "/accept-invite" };
  }
  if (isRecovery) {
    return { kind: "redirect", to: nextParam ?? "/reset-password" };
  }
  return { kind: "redirect", to: nextParam ?? "/dashboard" };
}
