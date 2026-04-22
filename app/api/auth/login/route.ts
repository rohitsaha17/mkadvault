// JSON API for login — replaces the Server Action so the sign-in POST
// goes through a plain route handler instead of the RSC action stack.
// Eliminates the "An unexpected response was received from the server"
// failure mode that blocked login after the recent proxy changes.
//
// Contract:
//   POST /api/auth/login
//   Body: { email: string, password: string }
//   Response: 200 JSON {success: true} on success, {error: string} on failure
// On success, the caller should router.push('/dashboard') + router.refresh().

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonOk() {
  return NextResponse.json({ success: true });
}
function jsonErr(error: string) {
  return NextResponse.json({ error });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) return jsonErr("Email is required");
  if (!/.+@.+\..+/.test(email)) return jsonErr("Invalid email address");
  if (!password) return jsonErr("Password is required");
  if (password.length < 6) {
    return jsonErr("Password must be at least 6 characters");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Friendly message for bad credentials — Supabase's raw message is "Invalid
    // login credentials" which is fine, but we normalise it so the user always
    // sees the same wording regardless of which GoTrue version is running.
    if (/invalid login credentials/i.test(error.message)) {
      return jsonErr("Invalid email or password. Please try again.");
    }
    if (/email not confirmed/i.test(error.message)) {
      return jsonErr(
        "Please confirm your email first — check your inbox for the confirmation link.",
      );
    }
    return jsonErr(error.message);
  }

  // Cookies are already set by createClient() via Supabase's SSR cookie
  // adapter — no extra work needed. Client will navigate to /dashboard.
  return jsonOk();
}
