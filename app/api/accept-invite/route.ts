// JSON API for the invite-acceptance "complete your profile" step.
//
// The client collects: full_name (editable, pre-filled from invite),
// phone (optional), password + confirm. We do everything in one shot:
//
//   1. Set the new auth password
//   2. Clear `needs_password_setup` on user_metadata so proxy + callback
//      stop routing the user back to /accept-invite
//   3. Stamp the possibly-edited full_name into user_metadata so future
//      greetings stay consistent
//   4. Update the profile row with full_name + phone
//
// Returns plain JSON `{success: true}` or `{error}` — same pattern as
// the /api/settings/users route, so the client speaks one protocol.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // Validate inputs
  const fullName =
    typeof body.full_name === "string" ? body.full_name.trim() : "";
  const phoneRaw =
    typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName) return jsonErr("Full name is required");
  if (fullName.length > 120) return jsonErr("Full name is too long");
  if (password.length < 8) {
    return jsonErr("Password must be at least 8 characters");
  }
  // Phone is optional — if provided, keep a sane length limit.
  if (phoneRaw && phoneRaw.length > 32) {
    return jsonErr("Phone number is too long");
  }

  // Must be an authenticated invitee — session was established when they
  // clicked the invite link and the callback handler verified the token.
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return jsonErr("Your invite session has expired. Click the invite link again.");
  }

  // Gate: this endpoint is only for users who came in via an invite and
  // still have `needs_password_setup`. If they don't, something's wrong
  // (e.g. they hit this URL directly) — bail out safely.
  const needsPasswordSetup = user.user_metadata?.needs_password_setup === true;
  if (!needsPasswordSetup) {
    return jsonErr(
      "Your account already has a password set. Please sign in instead.",
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonErr(
      "Server is missing SUPABASE_SERVICE_ROLE_KEY — set it in Vercel's environment variables.",
    );
  }

  const admin = createAdminClient();

  // ── Step 1: set password + update metadata (single GoTrue call) ──────────
  // Wrap in try/catch because the Supabase SDK sometimes throws on 5xx
  // responses rather than returning { error }. If this fails we abort before
  // touching the profile row, so nothing is half-updated.
  try {
    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: {
        ...user.user_metadata,
        full_name: fullName,
        needs_password_setup: false,
      },
    });
    if (authErr) return jsonErr(authErr.message);
  } catch (err) {
    return jsonErr(
      err instanceof Error
        ? `Couldn't set your password: ${err.message}`
        : "Couldn't set your password. Please try again.",
    );
  }

  // ── Step 2: update profile row with full_name + phone ────────────────────
  // Uses the admin client so RLS policy regressions can't block a valid
  // invitee from completing setup. We only update columns we own; org_id +
  // role were stamped by the admin at invite time and must not change here.
  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phoneRaw || null,
    })
    .eq("id", user.id);
  if (profileErr) {
    // The password IS already set at this point — the invitee can sign in.
    // Report the profile failure so the admin can fix the data later, but
    // don't make the invitee re-enter their password.
    console.error("[accept-invite] profile update failed:", profileErr);
    return jsonErr(
      `Password set, but we couldn't save your profile details: ${profileErr.message}. You can sign in and update them from your account settings.`,
    );
  }

  return jsonOk();
}
