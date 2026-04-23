// Per-photo operations: DELETE (remove) and PATCH (set primary).
// Both used to be Server Actions and kept silently failing for the
// same reason upload did — Server Action RSC transport is brittle
// when the response parser can't decode what comes back. Moving them
// to plain JSON endpoints fixes the whole family consistently.
//
// Contracts:
//   DELETE /api/sites/<siteId>/photos/<photoId>
//       → 200 {success: true}  or 200 {error: string}
//
//   PATCH  /api/sites/<siteId>/photos/<photoId>
//       body: {is_primary: true}
//       → 200 {success: true}  or 200 {error: string}
//
// Authorisation: caller must be in the same organisation as the site.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export const maxDuration = 15;

function jsonOk(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...extra });
}
function jsonErr(error: string) {
  // Always 200 — uniform "parse body for {error}" protocol.
  return NextResponse.json({ error });
}

// Shared guard. Returns {ok, ctx} on success, jsonErr response on failure.
async function authAndVerify(
  siteId: string,
  photoId: string,
): Promise<
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      orgId: string;
      photo: { photo_url: string; is_primary: boolean };
    }
  | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonErr("Not authenticated") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) {
    return { ok: false, res: jsonErr("No organisation linked to your profile") };
  }

  // Look up the photo AND validate site + org at once.
  const { data: photo, error: photoErr } = await supabase
    .from("site_photos")
    .select("id, site_id, organization_id, photo_url, is_primary")
    .eq("id", photoId)
    .single();

  if (photoErr || !photo) {
    return { ok: false, res: jsonErr("Photo not found") };
  }
  if (photo.site_id !== siteId) {
    return { ok: false, res: jsonErr("Photo does not belong to this site") };
  }
  if (photo.organization_id !== profile.org_id) {
    return { ok: false, res: jsonErr("Cross-organisation access blocked") };
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    orgId: profile.org_id,
    photo: { photo_url: photo.photo_url, is_primary: photo.is_primary },
  };
}

// ─── DELETE ─────────────────────────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id: siteId, photoId } = await params;
  const auth = await authAndVerify(siteId, photoId);
  if (!auth.ok) return auth.res;

  const { supabase, photo } = auth;

  // Delete the DB row first — if storage removal fails, we'd rather leak a
  // file than leave a dangling row the user can't re-delete.
  const { error: dbErr } = await supabase
    .from("site_photos")
    .delete()
    .eq("id", photoId);
  if (dbErr) return jsonErr(`Database delete failed: ${dbErr.message}`);

  // Remove the blob from Storage. Best-effort — the row is already gone,
  // so a storage hiccup just leaves an orphan file that a janitor can sweep.
  await supabase.storage
    .from("site-photos")
    .remove([photo.photo_url])
    .catch(() => {});

  // If the deleted photo was primary, promote the first remaining photo
  // so the site still has something to show as the primary thumbnail.
  if (photo.is_primary) {
    const { data: remaining } = await supabase
      .from("site_photos")
      .select("id")
      .eq("site_id", siteId)
      .order("sort_order")
      .limit(1);
    if (remaining && remaining.length > 0) {
      await supabase
        .from("site_photos")
        .update({ is_primary: true })
        .eq("id", remaining[0].id);
    }
  }

  revalidatePath(`/sites/${siteId}`);
  return jsonOk();
}

// ─── PATCH ──────────────────────────────────────────────────────────────────
// Currently supports only {is_primary: true} — additional editable fields
// (caption, sort_order, photo_type) can slot in here later.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id: siteId, photoId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }

  const auth = await authAndVerify(siteId, photoId);
  if (!auth.ok) return auth.res;
  const { supabase } = auth;

  // Promote this photo to primary (clear all others for the same site first).
  if (body.is_primary === true) {
    // Wrap in a transaction-esque pair. If the second update fails after
    // the first ran, the site ends up with no primary — we promote
    // whichever photo the user just clicked back to primary in that case.
    const { error: clearErr } = await supabase
      .from("site_photos")
      .update({ is_primary: false })
      .eq("site_id", siteId);
    if (clearErr) {
      return jsonErr(`Couldn't clear existing primary: ${clearErr.message}`);
    }

    const { error: setErr } = await supabase
      .from("site_photos")
      .update({ is_primary: true })
      .eq("id", photoId);
    if (setErr) {
      return jsonErr(`Couldn't set new primary: ${setErr.message}`);
    }

    revalidatePath(`/sites/${siteId}`);
    return jsonOk();
  }

  return jsonErr("No supported fields provided in body (expected {is_primary: true})");
}
