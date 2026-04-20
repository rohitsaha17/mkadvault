// Auth callback route — exchanges the Supabase auth code for a session.
// Supabase redirects here after email-based flows (password reset, magic link).
// The `next` query param controls where to send the user after verification.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Successful verification — redirect to the intended destination
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Something went wrong — send user back to login with an error message
  return NextResponse.redirect(
    new URL("/login?error=Could not verify your identity", origin)
  );
}
