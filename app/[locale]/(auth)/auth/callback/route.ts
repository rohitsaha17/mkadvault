// Auth callback route — exchanges the Supabase auth code for a session.
// Supabase redirects here after email-based flows (password reset, magic link,
// invite). The `next` query param controls where to send the user after
// verification (default /dashboard).
//
// Special case: if the signed-in user still has `needs_password_setup` in
// their metadata (stamped when an admin invited them), we route them to the
// accept-invite screen — they must set a password and see the welcome
// message before landing on the dashboard.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const explicitNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if this is an invite acceptance (needs password setup).
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const needsPasswordSetup =
        !!user?.user_metadata?.needs_password_setup;

      const destination = needsPasswordSetup
        ? "/accept-invite"
        : (explicitNext ?? "/dashboard");

      return NextResponse.redirect(new URL(destination, origin));
    }
  }

  // Something went wrong — send user back to login with an error message
  return NextResponse.redirect(
    new URL("/login?error=Could not verify your identity", origin)
  );
}
