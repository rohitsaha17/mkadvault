"use server";
// Site Server Actions — create, update, soft-delete sites.
// All mutations go through Supabase with RLS enforced.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteSchema } from "@/lib/validations/site";
import { getSignedUrls } from "@/lib/supabase/signed-urls";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
// Ensures the given Storage bucket exists. Uses the service-role admin
// client because creating buckets requires elevated privileges. No-op if
// the bucket is already present. Silently ignores "already exists" races.
async function ensureBucket(bucketId: string): Promise<{ error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error: `Storage bucket "${bucketId}" is missing and the app isn't configured to auto-create it. Ask an admin to run migration 023_create_storage_buckets.sql or create the bucket in Supabase.`,
    };
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.createBucket(bucketId, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB safety ceiling
    });
    // "Bucket already exists" is expected on subsequent calls — treat as success.
    if (error && !/already exists/i.test(error.message)) {
      return { error: error.message };
    }
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : `Could not create bucket ${bucketId}`,
    };
  }
}

type ActionResult = { error: string } | { success: true; siteId: string };

// Some Supabase projects haven't had migration 021 applied yet, so the
// `custom_dimensions` column may be missing from the PostgREST schema cache.
// Detect that specific error and let the caller retry without the column.
function isCustomDimensionsMissing(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  return (
    (err.code === "PGRST204" || err.code === "42703") &&
    /custom_dimensions/i.test(err.message ?? "")
  );
}

// Auto-generate a site code when the user leaves it blank. Format:
// "{CITY3}-{4 random alphanum}" e.g. "MUM-4F2A". Uniqueness is enforced
// by the DB unique index; collisions are vanishingly rare with 36^4 space.
function generateSiteCode(city: string): string {
  const prefix = (city || "SITE").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "SITE";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

// ─── createSite ───────────────────────────────────────────────────────────────

export async function createSite(values: unknown): Promise<ActionResult> {
  try {
    const parsed = siteSchema.safeParse(values);
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message };
    }

    // NaN can arrive from empty number inputs even after Zod parses them
    const raw = parsed.data;
    const d = {
      ...raw,
      latitude: Number.isFinite(raw.latitude) ? raw.latitude : undefined,
      longitude: Number.isFinite(raw.longitude) ? raw.longitude : undefined,
      width_ft: Number.isFinite(raw.width_ft) ? raw.width_ft : undefined,
      height_ft: Number.isFinite(raw.height_ft) ? raw.height_ft : undefined,
      visibility_distance_m: Number.isFinite(raw.visibility_distance_m) ? raw.visibility_distance_m : undefined,
      base_rate_inr: Number.isFinite(raw.base_rate_inr) ? raw.base_rate_inr : undefined,
    };
    const supabase = await createClient();

    // Look up the user's org_id (RLS will enforce this anyway, but we need it for INSERT)
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (!profile?.org_id) {
      return { error: "No organisation found. Please contact support." };
    }

    // Convert INR → paise for storage
    const base_rate_paise =
      d.base_rate_inr !== undefined ? Math.round(d.base_rate_inr * 100) : null;

    // landowner_id only applies to owned sites (enforced at DB via CHECK constraint)
    const landowner_id = d.ownership_model === "owned" ? d.landowner_id ?? null : null;

    // Auto-generate site code if the user left it blank.
    const finalSiteCode = d.site_code?.trim() ? d.site_code.trim() : generateSiteCode(d.city);

    const basePayload = {
      organization_id: profile.org_id,
      created_by: user.id,
      updated_by: user.id,
      name: d.name,
      site_code: finalSiteCode,
      media_type: d.media_type,
      structure_type: d.structure_type,
      status: d.status,
      address: d.address,
      city: d.city,
      state: d.state,
      pincode: d.pincode ?? null,
      landmark: d.landmark ?? null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      width_ft: d.width_ft ?? null,
      height_ft: d.height_ft ?? null,
      illumination: d.illumination ?? null,
      facing: d.facing ?? null,
      traffic_side: d.traffic_side ?? null,
      visibility_distance_m: d.visibility_distance_m ? Math.round(d.visibility_distance_m) : null,
      ownership_model: d.ownership_model,
      landowner_id,
      base_rate_paise,
      municipal_permission_number: d.municipal_permission_number ?? null,
      municipal_permission_expiry: d.municipal_permission_expiry ?? null,
      notes: d.notes ?? null,
    };

    const cleanedDimensions = (d.custom_dimensions ?? []).filter(
      (x) => x.label?.trim() && x.value?.trim()
    );

    // First attempt: include custom_dimensions. If the column is missing from
    // the PostgREST schema cache (migration 021 not applied), retry without it.
    let insertRes = await supabase
      .from("sites")
      .insert({ ...basePayload, custom_dimensions: cleanedDimensions })
      .select("id")
      .single();

    if (insertRes.error && isCustomDimensionsMissing(insertRes.error)) {
      console.warn("[sites] custom_dimensions column missing — retrying insert without it");
      insertRes = await supabase
        .from("sites")
        .insert(basePayload)
        .select("id")
        .single();
    }

    const { data: site, error } = insertRes;

    if (error) {
      // Friendly message for duplicate site_code
      if (error.code === "23505") {
        return { error: `Site code "${finalSiteCode}" already exists. Use a unique code.` };
      }
      return { error: error.message };
    }

    revalidatePath("/sites");
    return { success: true, siteId: site.id };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createSite");
  }
}

// ─── updateSite ───────────────────────────────────────────────────────────────

export async function updateSite(
  siteId: string,
  values: unknown
): Promise<ActionResult> {
  try {
    const parsed = siteSchema.safeParse(values);
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message };
    }

    const rawUpdate = parsed.data;
    const d = {
      ...rawUpdate,
      latitude: Number.isFinite(rawUpdate.latitude) ? rawUpdate.latitude : undefined,
      longitude: Number.isFinite(rawUpdate.longitude) ? rawUpdate.longitude : undefined,
      width_ft: Number.isFinite(rawUpdate.width_ft) ? rawUpdate.width_ft : undefined,
      height_ft: Number.isFinite(rawUpdate.height_ft) ? rawUpdate.height_ft : undefined,
      visibility_distance_m: Number.isFinite(rawUpdate.visibility_distance_m) ? rawUpdate.visibility_distance_m : undefined,
      base_rate_inr: Number.isFinite(rawUpdate.base_rate_inr) ? rawUpdate.base_rate_inr : undefined,
    };
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const base_rate_paise =
      d.base_rate_inr !== undefined ? Math.round(d.base_rate_inr * 100) : null;

    const landowner_id = d.ownership_model === "owned" ? d.landowner_id ?? null : null;

    const finalSiteCode = d.site_code?.trim() ? d.site_code.trim() : generateSiteCode(d.city);

    const basePayload = {
      updated_by: user.id,
      landowner_id,
      name: d.name,
      site_code: finalSiteCode,
      media_type: d.media_type,
      structure_type: d.structure_type,
      status: d.status,
      address: d.address,
      city: d.city,
      state: d.state,
      pincode: d.pincode ?? null,
      landmark: d.landmark ?? null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      width_ft: d.width_ft ?? null,
      height_ft: d.height_ft ?? null,
      illumination: d.illumination ?? null,
      facing: d.facing ?? null,
      traffic_side: d.traffic_side ?? null,
      visibility_distance_m: d.visibility_distance_m ? Math.round(d.visibility_distance_m) : null,
      ownership_model: d.ownership_model,
      base_rate_paise,
      municipal_permission_number: d.municipal_permission_number ?? null,
      municipal_permission_expiry: d.municipal_permission_expiry ?? null,
      notes: d.notes ?? null,
    };

    const cleanedDimensions = (d.custom_dimensions ?? []).filter(
      (x) => x.label?.trim() && x.value?.trim()
    );

    let updateRes = await supabase
      .from("sites")
      .update({ ...basePayload, custom_dimensions: cleanedDimensions })
      .eq("id", siteId);

    if (updateRes.error && isCustomDimensionsMissing(updateRes.error)) {
      console.warn("[sites] custom_dimensions column missing — retrying update without it");
      updateRes = await supabase.from("sites").update(basePayload).eq("id", siteId);
    }

    const { error } = updateRes;

    if (error) {
      if (error.code === "23505") {
        return { error: `Site code "${finalSiteCode}" already exists. Use a unique code.` };
      }
      return { error: error.message };
    }

    revalidatePath("/sites");
    revalidatePath(`/sites/${siteId}`);
    return { success: true, siteId };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "updateSite");
  }
}

// ─── deleteSite (soft-delete) ─────────────────────────────────────────────────

export async function deleteSite(siteId: string): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    // Role check — only super_admin and admin can delete
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !["super_admin", "admin"].includes(profile.role)) {
      return { error: "Only admins can delete records" };
    }

    // Guard: check for active campaigns linked to this site
    // Active campaign statuses = anything that isn't cancelled, completed, or dismounted
    const { count: activeCampaignSites } = await supabase
      .from("campaign_sites")
      .select("id, campaigns!inner(status)", { count: "exact", head: true })
      .eq("site_id", siteId)
      .not("campaigns.status", "in", '("cancelled","completed","dismounted")');

    if (activeCampaignSites && activeCampaignSites > 0) {
      return { error: "Cannot delete site with active campaigns" };
    }

    const { error } = await supabase
      .from("sites")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", siteId);

    if (error) return { error: error.message };

    revalidatePath("/sites");
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteSite");
  }
}

// ─── uploadSitePhoto ──────────────────────────────────────────────────────────
// Uploads a single photo to Supabase Storage and inserts a site_photos row.
// Called from the client-side photo uploader.

type UploadedPhoto = {
  id: string;
  site_id: string;
  organization_id: string;
  photo_url: string;
  photo_type: string;
  is_primary: boolean;
  sort_order: number;
};

export async function uploadSitePhoto(
  siteId: string,
  formData: FormData
): Promise<{ error?: string; photo?: UploadedPhoto }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const file = formData.get("file") as File | null;
    if (!file) return { error: "No file provided" };

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return { error: "File too large. Maximum 5MB per photo." };
    }

    // Validate type
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return { error: "Invalid file type. Only JPG, PNG, WEBP are accepted." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (!profile?.org_id) return { error: "No organisation found." };

    // Storage path: {org_id}/{site_id}/{timestamp}-{filename}
    const ext = file.name.split(".").pop() ?? "jpg";
    const storagePath = `${profile.org_id}/${siteId}/${Date.now()}.${ext}`;

    // Upload with auto-retry if the bucket hasn't been created yet in this
    // Supabase project. Migration 023_create_storage_buckets.sql provisions
    // the buckets, but we don't want a fresh env to blow up before that
    // migration is applied — so we create the bucket on the fly using the
    // admin client and retry once.
    let uploadRes = await supabase.storage
      .from("site-photos")
      .upload(storagePath, file);

    if (uploadRes.error && /bucket not found/i.test(uploadRes.error.message)) {
      console.warn("[sites] site-photos bucket missing — auto-creating");
      const ensured = await ensureBucket("site-photos");
      if (ensured.error) return { error: ensured.error };
      uploadRes = await supabase.storage
        .from("site-photos")
        .upload(storagePath, file);
    }

    if (uploadRes.error) return { error: uploadRes.error.message };

    // Check if this is the first photo (make it primary)
    const { count } = await supabase
      .from("site_photos")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId);

    const is_primary = count === 0;

    const { data: photo, error: dbError } = await supabase
      .from("site_photos")
      .insert({
        organization_id: profile.org_id,
        site_id: siteId,
        created_by: user.id,
        photo_url: storagePath,
        photo_type: "day",
        is_primary,
        sort_order: count ?? 0,
      })
      .select("id, site_id, organization_id, photo_url, photo_type, is_primary, sort_order")
      .single();

    if (dbError) return { error: dbError.message };

    revalidatePath(`/sites/${siteId}`);
    return { photo: photo as UploadedPhoto };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "uploadSitePhoto");
  }
}

// ─── deleteSitePhoto ──────────────────────────────────────────────────────────

export async function deleteSitePhoto(
  photoId: string,
  siteId: string
): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();

    // Get the photo URL before deleting the row (needed to remove from Storage)
    const { data: photo } = await supabase
      .from("site_photos")
      .select("photo_url, is_primary")
      .eq("id", photoId)
      .single();

    if (!photo) return { error: "Photo not found" };

    const { error } = await supabase
      .from("site_photos")
      .delete()
      .eq("id", photoId);

    if (error) return { error: error.message };

    // Remove from Storage (best-effort; ignore errors)
    await supabase.storage.from("site-photos").remove([photo.photo_url]);

    // If the deleted photo was primary, promote the first remaining photo
    if (photo.is_primary) {
      const { data: remaining } = await supabase
        .from("site_photos")
        .select("id")
        .eq("site_id", siteId)
        .order("sort_order")
        .limit(1);

      if (remaining?.[0]) {
        await supabase
          .from("site_photos")
          .update({ is_primary: true })
          .eq("id", remaining[0].id);
      }
    }

    revalidatePath(`/sites/${siteId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "deleteSitePhoto");
  }
}

// ─── createSitesFromImport ────────────────────────────────────────────────────
// Bulk-create sites from the proposal-import review UI. Each row has been
// reviewed and (potentially) edited by the user, so the data here is
// treated as authoritative. For rows where the extractor attached an
// image from storage (a path under "_imports/..."), we copy the blob to
// the new site's permanent photo path and register it as the primary
// photo.
//
// Returns the IDs of the sites actually created, plus the indices of
// rows that were skipped due to validation errors — so the caller can
// surface them to the user and let them retry individual rows.

export interface ImportSiteInput {
  name: string;
  site_code?: string | null;
  media_type: "billboard" | "hoarding" | "dooh" | "kiosk" | "wall_wrap" | "unipole" | "bus_shelter" | "custom";
  structure_type: "permanent" | "temporary" | "digital";
  address: string;
  city: string;
  state: string;
  pincode?: string | null;
  landmark?: string | null;
  width_ft: number;
  height_ft: number;
  illumination: "frontlit" | "backlit" | "digital" | "nonlit";
  facing?: "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW" | null;
  traffic_side: "lhs" | "rhs" | "both";
  visibility_distance_m?: number | null;
  base_rate_inr?: number | null;
  notes?: string | null;
  // Storage path under site-photos for the imported image. Null means no
  // photo attached to this site.
  image_storage_path?: string | null;
}

export interface ImportResult {
  createdSiteIds: string[];
  errors: { index: number; message: string }[];
}

export async function createSitesFromImport(
  rows: ImportSiteInput[]
): Promise<ImportResult | { error: string }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!profile?.org_id) return { error: "No organisation found" };
    const orgId = profile.org_id as string;

    const createdSiteIds: string[] = [];
    const errors: { index: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Only accept images that live under this org's `_imports/` prefix —
      // prevents a crafted request from copying arbitrary storage files.
      const safeImagePath =
        row.image_storage_path && row.image_storage_path.startsWith(`${orgId}/_imports/`)
          ? row.image_storage_path
          : null;

      const finalSiteCode = row.site_code?.trim()
        ? row.site_code.trim()
        : generateSiteCode(row.city);

      const basePayload = {
        organization_id: orgId,
        created_by: user.id,
        updated_by: user.id,
        name: row.name,
        site_code: finalSiteCode,
        media_type: row.media_type,
        structure_type: row.structure_type,
        status: "available" as const,
        address: row.address,
        city: row.city,
        state: row.state,
        pincode: row.pincode ?? null,
        landmark: row.landmark ?? null,
        width_ft: row.width_ft,
        height_ft: row.height_ft,
        illumination: row.illumination,
        facing: row.facing ?? null,
        traffic_side: row.traffic_side,
        visibility_distance_m: row.visibility_distance_m
          ? Math.round(row.visibility_distance_m)
          : null,
        ownership_model: "rented" as const, // Import defaults to "rented" — user can change later
        base_rate_paise:
          typeof row.base_rate_inr === "number" ? Math.round(row.base_rate_inr * 100) : null,
        notes: row.notes ?? null,
      };

      let insertRes = await supabase
        .from("sites")
        .insert(basePayload)
        .select("id")
        .single();

      // Retry without the column if a deployment is pre-migration-021.
      if (insertRes.error && isCustomDimensionsMissing(insertRes.error)) {
        insertRes = await supabase.from("sites").insert(basePayload).select("id").single();
      }

      if (insertRes.error || !insertRes.data) {
        errors.push({
          index: i,
          message:
            insertRes.error?.code === "23505"
              ? `Site code "${finalSiteCode}" already exists.`
              : insertRes.error?.message ?? "Failed to create site.",
        });
        continue;
      }

      const newSiteId = insertRes.data.id as string;
      createdSiteIds.push(newSiteId);

      // Move the image from the _imports/ staging path to the site's
      // permanent path. We use the admin client because the user's RLS
      // insert policy on site_photos doesn't help with storage copies.
      if (safeImagePath) {
        const admin = createAdminClient();
        const ext = safeImagePath.split(".").pop() ?? "png";
        const finalPath = `${orgId}/${newSiteId}/${Date.now()}.${ext}`;
        const { error: copyErr } = await admin.storage
          .from("site-photos")
          .copy(safeImagePath, finalPath);

        if (copyErr) {
          console.warn("[import] image copy failed", copyErr);
        } else {
          await admin.storage.from("site-photos").remove([safeImagePath]);
          await supabase.from("site_photos").insert({
            organization_id: orgId,
            site_id: newSiteId,
            created_by: user.id,
            photo_url: finalPath,
            photo_type: "day",
            is_primary: true,
            sort_order: 0,
          });
        }
      }
    }

    revalidatePath("/sites");
    return { createdSiteIds, errors };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "createSitesFromImport");
  }
}

// ─── setSitePrimaryPhoto ──────────────────────────────────────────────────────

export async function setSitePrimaryPhoto(
  photoId: string,
  siteId: string
): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();

    // Clear existing primary flag for this site
    await supabase
      .from("site_photos")
      .update({ is_primary: false })
      .eq("site_id", siteId);

    // Set new primary
    const { error } = await supabase
      .from("site_photos")
      .update({ is_primary: true })
      .eq("id", photoId);

    if (error) return { error: error.message };

    revalidatePath(`/sites/${siteId}`);
    return {};
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "setSitePrimaryPhoto");
  }
}

// ─── redirectAfterCreate ─────────────────────────────────────────────────────
// Call this from the client after a successful createSite to navigate to detail.

export async function redirectToSite(siteId: string): Promise<never> {
  redirect(`/sites/${siteId}`);
}

// ─── getSitePhotosWithSignedUrls ────────────────────────────────────────────
// Fetches every photo for a site plus short-lived signed URLs. Used by the
// photo lightbox (opened from the sites list thumbnail and from the detail
// page gallery) so the gallery can be populated on-demand without the list
// page having to pre-sign URLs for every photo on every site.
//
// Returns { photos, signedUrls, siteName } where signedUrls is a map of
// {storagePath → signedUrl}. Paths that couldn't be signed are simply
// omitted from the map — the client falls back to a placeholder.

type SitePhotoLite = {
  id: string;
  photo_url: string;
  photo_type: string;
  is_primary: boolean;
  sort_order: number;
};

type SitePhotosResult =
  | { error: string; photos?: undefined; signedUrls?: undefined; siteName?: undefined }
  | {
      photos: SitePhotoLite[];
      signedUrls: Record<string, string>;
      siteName: string;
      error?: undefined;
    };

export async function getSitePhotosWithSignedUrls(
  siteId: string,
): Promise<SitePhotosResult> {
  try {
    const supabase = await createClient();

    // Fetch the site name (for the lightbox title) and all photos in parallel.
    const [{ data: site }, { data: photoRows }] = await Promise.all([
      supabase.from("sites").select("name").eq("id", siteId).maybeSingle(),
      supabase
        .from("site_photos")
        .select("id, photo_url, photo_type, is_primary, sort_order")
        .eq("site_id", siteId)
        .order("is_primary", { ascending: false })
        .order("sort_order")
        .limit(50),
    ]);

    if (!site) return { error: "Site not found" };

    const photos = (photoRows ?? []) as SitePhotoLite[];

    // Sign all storage paths in a single batch call.
    const signedUrls = await getSignedUrls(
      "site-photos",
      photos.map((p) => p.photo_url),
    );

    return { photos, signedUrls, siteName: site.name as string };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "getSitePhotosWithSignedUrls");
  }
}

// ─── getSitePreview ──────────────────────────────────────────────────────────
// Fetches a lightweight subset of site fields + up to 4 photos for the preview
// modal. Uses the regular Supabase client so RLS is enforced.

type SitePreviewData = {
  id: string;
  name: string;
  site_code: string;
  city: string;
  state: string;
  address: string;
  media_type: string;
  illumination: string | null;
  width_ft: number | null;
  height_ft: number | null;
  total_sqft: number | null;
  base_rate_paise: number | null;
  status: string;
  facing: string | null;
  traffic_side: string | null;
  landmark: string | null;
};

type SitePreviewPhoto = {
  id: string;
  photo_url: string;
  photo_type: string;
  is_primary: boolean;
};

type SitePreviewResult =
  | { error: string; site?: undefined; photos?: undefined; signedUrls?: undefined }
  | {
      site: SitePreviewData;
      photos: SitePreviewPhoto[];
      // Map of {storagePath → signedUrl}. site-photos is a private bucket,
      // so the preview modal can't construct public URLs — it must use these.
      signedUrls: Record<string, string>;
      error?: undefined;
    };

export async function getSitePreview(siteId: string): Promise<SitePreviewResult> {
  try {
    const supabase = await createClient();

    const [{ data: site }, { data: photos }] = await Promise.all([
      supabase
        .from("sites")
        .select(
          "id, name, site_code, city, state, address, media_type, illumination, width_ft, height_ft, total_sqft, base_rate_paise, status, facing, traffic_side, landmark"
        )
        .eq("id", siteId)
        .single(),
      supabase
        .from("site_photos")
        .select("id, photo_url, photo_type, is_primary")
        .eq("site_id", siteId)
        .order("is_primary", { ascending: false })
        .order("sort_order")
        .limit(4),
    ]);

    if (!site) return { error: "Site not found" };
    const photoList = (photos ?? []) as SitePreviewPhoto[];
    const signedUrls = await getSignedUrls(
      "site-photos",
      photoList.map((p) => p.photo_url),
    );
    return { site: site as SitePreviewData, photos: photoList, signedUrls };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "getSitePreview");
  }
}
