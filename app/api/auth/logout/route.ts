// JSON API for logout — replaces the Server Action so the sign-out
// click can fire-and-forget. The client can navigate to /login
// immediately with window.location.assign() and let this API clear
// the Supabase session in parallel. That makes logout feel INSTANT
// rather than waiting for the RSC round-trip of a Server Action.
//
// Contract:
//   POST /api/auth/logout
//   Response: 200 JSON {success: true}
// Failure is non-fatal — if signOut() fails we still return success
// because the client has already navigated away; worst case the
// cookies expire on their own.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (err) {
    // Log but never throw — the client is already on its way to /login.
    console.error("[auth/logout] signOut failed:", err);
  }
  return NextResponse.json({ success: true });
}
