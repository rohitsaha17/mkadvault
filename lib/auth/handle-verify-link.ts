// Shared verification logic for every email-link handler route
// (/auth/callback, /auth/confirm, /auth/verify). Supabase has several
// default email templates across versions — each points at a slightly
// different URL — so we register all three paths and funnel them
// through this one helper to eliminate the "email link goes to login"
// bug class.
//
// Supabase emits three link shapes in the wild:
//   1. ?code=<pkce_code>                    (PKCE; newer default)
//   2. ?token_hash=<hash>&type=<t>          (OTP verify; 2024+ default for
//                                            invite / recovery / email-change)
//   3. ?token=<hash>&type=<t>               (legacy alias for #2; some
//                                            custom templates still use this)
// We accept all three so "the email link works" regardless of what
// template the admin kept in Supabase Auth settings.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function handleVerifyLink(request: NextRequest): Promise<Response> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash") ?? searchParams.get("token");
  const type = searchParams.get("type") as EmailOtpType | null;
  const explicitNext = searchParams.get("next");

  const supabase = await createClient();

  let verified = false;
  let errMessage: string | null = null;

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      verified = !error;
      errMessage = error?.message ?? null;
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      verified = !error;
      errMessage = error?.message ?? null;
    } else {
      errMessage =
        "The invite link is incomplete. Ask your admin to send a fresh invite.";
    }
  } catch (err) {
    console.error("[auth/verify] exception during verification:", err);
    errMessage =
      err instanceof Error ? err.message : "Verification failed. Try again.";
  }

  if (verified) {
    // Who did we just sign in?
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const needsPasswordSetup = !!user?.user_metadata?.needs_password_setup;
    const isRecovery = type === "recovery";

    // Routing priority:
    //   * Invite with needs_password_setup → /accept-invite (always wins —
    //     the invitee must set a password before going anywhere)
    //   * Password recovery → /reset-password (user asked to reset)
    //   * Otherwise → next= param or /dashboard
    let destination: string;
    if (needsPasswordSetup) {
      destination = "/accept-invite";
    } else if (isRecovery) {
      destination = explicitNext ?? "/reset-password";
    } else {
      destination = explicitNext ?? "/dashboard";
    }

    return NextResponse.redirect(new URL(destination, origin));
  }

  // Failure path — send the user back to login with a specific error so
  // they know why, rather than the old generic "Could not verify your
  // identity" which left everyone guessing.
  const reason = errMessage
    ? `Invite link problem: ${errMessage}`
    : "Could not verify your identity. Ask for a fresh invite link.";
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", reason);
  return NextResponse.redirect(loginUrl);
}
