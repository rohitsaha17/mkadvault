// Auth callback route — establishes a session from the link Supabase
// emailed the user (password reset, magic link, invite). The `next` query
// param controls where to send the user after verification (default
// /dashboard).
//
// Supabase emits two link shapes depending on the project's email template
// config:
//   1. `?code=<pkce_code>`            → exchangeCodeForSession
//   2. `?token_hash=<hash>&type=<t>`  → verifyOtp (newer default for invites,
//                                       password recovery, signup confirms)
// We handle both so the callback works regardless of template version.
//
// Special case: if the signed-in user still has `needs_password_setup` in
// their metadata (stamped when an admin invited them), we route them to the
// accept-invite screen — they must set a password and see the welcome
// message before landing on the dashboard.
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const explicitNext = searchParams.get("next");

  const supabase = await createClient();

  // Try whichever flow matches the incoming params.
  let verified = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    verified = !error;
  }

  if (verified) {
    // Check if this is an invite acceptance (needs password setup).
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const needsPasswordSetup = !!user?.user_metadata?.needs_password_setup;

    // Invite acceptance wins over `next` — an invitee must set a password
    // before they're allowed anywhere else. Otherwise honor `next` (used
    // e.g. for password-reset flows) and fall back to /dashboard.
    const destination = needsPasswordSetup
      ? "/accept-invite"
      : (explicitNext ?? "/dashboard");

    return NextResponse.redirect(new URL(destination, origin));
  }

  // Something went wrong — send user back to login with an error message
  return NextResponse.redirect(
    new URL("/login?error=Could not verify your identity", origin)
  );
}
