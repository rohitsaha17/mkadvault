// JSON API for site photo uploads — one file per POST. Replaces the
// Server Action that kept silently failing on binary bodies (Server
// Actions' RSC transport struggles with large multipart payloads and
// surfaces no error when it does). Plain route handler: browser POSTs
// multipart/form-data, we save to Supabase Storage and return JSON.
//
// Contract:
//   POST /api/sites/<siteId>/photos
//   Body: multipart/form-data with a single "file" field
//   Response: 200 JSON {photo: {...}} on success, {error: string} on failure
// Client uploads N photos by firing N POSTs in parallel — no sequential
// round-trips.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

// Uploads can be chunky — bump beyond the default 1 MB body limit.
export const maxDuration = 30;

function jsonOk(data: Record<string, unknown>) {
  return NextResponse.json({ success: true, ...data });
}
function jsonErr(error: string, status = 200) {
  // 200 keeps the protocol uniform — client always parses body for {error}.
  return NextResponse.json({ error }, { status });
}

// Ensure the site-photos bucket exists. Cheap no-op after first call per
// process; only blows up if SUPABASE_SERVICE_ROLE_KEY is unset.
async function ensureSitePhotosBucket(): Promise<{ error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error:
        'Storage bucket "site-photos" is missing. Apply migration 023 or set SUPABASE_SERVICE_ROLE_KEY.',
    };
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.createBucket("site-photos", {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
    });
    if (error && !/already exists/i.test(error.message)) {
      return { error: error.message };
    }
    return {};
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Could not create site-photos bucket",
    };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: siteId } = await params;

  const supabase = await createClient();

  // Auth
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return jsonErr("Not authenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) return jsonErr("No organisation linked to your profile");

  // Verify the site belongs to the caller's org so another tenant can't
  // slip files into our bucket.
  const { data: site } = await supabase
    .from("sites")
    .select("id, organization_id")
    .eq("id", siteId)
    .single();
  if (!site) return jsonErr("Site not found");
  if (site.organization_id !== profile.org_id) {
    return jsonErr("Cross-organisation site access blocked");
  }

  // Parse multipart body
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonErr(
      err instanceof Error ? `Invalid upload body: ${err.message}` : "Invalid upload body",
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonErr("No file attached");

  // Optional campaign provenance. When present, the photo is stamped
  // with campaign_id (+ campaign_site_id) so it can be grouped on the
  // campaign page AND still flows into the site's own gallery.
  const campaignIdRaw = form.get("campaign_id");
  const campaignSiteIdRaw = form.get("campaign_site_id");
  const campaignId =
    typeof campaignIdRaw === "string" && campaignIdRaw.length > 0
      ? campaignIdRaw
      : null;
  const campaignSiteId =
    typeof campaignSiteIdRaw === "string" && campaignSiteIdRaw.length > 0
      ? campaignSiteIdRaw
      : null;

  // If a campaign was specified, verify it belongs to this org and the
  // caller is allowed to post photos against it. The campaign's creator
  // always can; admins / managers / executives can too.
  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, organization_id, created_by")
      .eq("id", campaignId)
      .single();
    if (!campaign) return jsonErr("Campaign not found");
    if (campaign.organization_id !== profile.org_id) {
      return jsonErr("Cross-organisation campaign access blocked");
    }

    const { data: roleProfile } = await supabase
      .from("profiles")
      .select("role, roles")
      .eq("id", user.id)
      .single();
    const roles: string[] =
      Array.isArray((roleProfile as { roles?: string[] } | null)?.roles) &&
      ((roleProfile as { roles?: string[] } | null)?.roles?.length ?? 0) > 0
        ? ((roleProfile as { roles?: string[] }).roles as string[])
        : [roleProfile?.role ?? ""];
    const isCreator = campaign.created_by === user.id;
    const isPrivileged = roles.some((r) =>
      ["super_admin", "admin", "manager", "executive"].includes(r),
    );
    if (!isCreator && !isPrivileged) {
      return jsonErr(
        "Only the campaign's creator or an admin / manager / executive can upload campaign photos.",
      );
    }

    // If a campaign_site_id was given, sanity-check it points to the
    // same site + campaign — otherwise the UI would show the photo
    // under the wrong row.
    if (campaignSiteId) {
      const { data: cs } = await supabase
        .from("campaign_sites")
        .select("id, campaign_id, site_id")
        .eq("id", campaignSiteId)
        .single();
      if (!cs) return jsonErr("Campaign-site link not found");
      if (cs.campaign_id !== campaignId || cs.site_id !== siteId) {
        return jsonErr("campaign_site_id doesn't match campaign/site");
      }
    }
  }

  // Validate — reject clearly so the user sees exactly why nothing uploaded.
  if (file.size === 0) return jsonErr("The selected file is empty.");
  if (file.size > 5 * 1024 * 1024) {
    return jsonErr(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — over the 5 MB limit.`);
  }
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return jsonErr(`"${file.name}" is ${file.type || "an unsupported type"}. Only JPG, PNG, WEBP are accepted.`);
  }

  // Auto-create bucket on first use in a fresh environment.
  const ensured = await ensureSitePhotosBucket();
  if (ensured.error) return jsonErr(ensured.error);

  // Storage path: {org}/{site}/{timestamp}-{original_filename_sanitised}
  const safeBase = (file.name.split(".").slice(0, -1).join(".") || "photo")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(-60);
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const storagePath = `${profile.org_id}/${siteId}/${Date.now()}_${safeBase}.${ext}`;

  // Upload the file bytes. Note: we read the file once into a Buffer via
  // arrayBuffer() — that's what the Supabase JS client needs. For files
  // up to 5 MB this is fine; streaming would require a different API.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage
    .from("site-photos")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    return jsonErr(`Storage upload failed: ${uploadErr.message}`);
  }

  // Make the first photo primary.
  const { count: existingCount } = await supabase
    .from("site_photos")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);

  const isPrimary = (existingCount ?? 0) === 0;

  const { data: inserted, error: dbErr } = await supabase
    .from("site_photos")
    .insert({
      organization_id: profile.org_id,
      site_id: siteId,
      created_by: user.id,
      photo_url: storagePath,
      photo_type: "day",
      is_primary: isPrimary,
      sort_order: existingCount ?? 0,
      campaign_id: campaignId,
      campaign_site_id: campaignSiteId,
    })
    .select(
      "id, site_id, organization_id, photo_url, photo_type, is_primary, sort_order, campaign_id, campaign_site_id",
    )
    .single();

  if (dbErr) {
    // Try to clean up the orphan file. Best-effort — don't fail the
    // request because the user can re-upload; the orphan just wastes
    // space until a janitor job sweeps.
    await supabase.storage
      .from("site-photos")
      .remove([storagePath])
      .catch(() => {});
    return jsonErr(`Database insert failed: ${dbErr.message}`);
  }

  // Generate a signed URL immediately so the client can render the new
  // photo without waiting for a page refresh or the router.refresh()
  // round-trip.
  const { data: signed } = await supabase.storage
    .from("site-photos")
    .createSignedUrl(storagePath, 60 * 60);

  // Invalidate the site page so visitors see the new count / primary
  // photo from server-rendered components on their next nav. Also bust
  // the campaign page when the photo was campaign-scoped so the Photos
  // tab picks it up immediately.
  revalidatePath(`/sites/${siteId}`);
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);

  return jsonOk({
    photo: inserted,
    signedUrl: signed?.signedUrl ?? null,
  });
}
