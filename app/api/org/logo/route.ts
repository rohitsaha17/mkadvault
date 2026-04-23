// JSON API for uploading / clearing the organisation logo.
// Logos live in a private "org-logos" storage bucket under
// {org_id}/logo-{timestamp}.<ext>. The storage path is written back
// to organizations.logo_url; the PPTX exporter (and the org settings
// form thumbnail) fetches a signed URL at render time.
//
// Contracts:
//   POST   /api/org/logo   (multipart/form-data, field="file")
//     → 200 {success: true, logo_url: <storage path>, signedUrl: <1h>}
//   DELETE /api/org/logo
//     → 200 {success: true}  — clears organizations.logo_url + storage blob
//
// Role-gated: only super_admin / admin can touch the org logo (it's
// effectively a brand asset used on every exported proposal).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

function jsonOk(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...extra });
}
function jsonErr(error: string) {
  return NextResponse.json({ error });
}

const ADMIN_ROLES = ["super_admin", "admin"];
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

async function ensureOrgLogosBucket(): Promise<{ error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error: "SUPABASE_SERVICE_ROLE_KEY is missing — can't auto-create the org-logos bucket.",
    };
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.createBucket("org-logos", {
      public: false,
      fileSizeLimit: 2 * 1024 * 1024, // 2 MB cap
    });
    if (error && !/already exists/i.test(error.message)) {
      return { error: error.message };
    }
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Couldn't create org-logos bucket",
    };
  }
}

// Shared auth + admin-role check
async function guard(): Promise<
  | { ok: true; userId: string; orgId: string; prevLogoPath: string | null }
  | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonErr("Not authenticated") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, roles")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) {
    return { ok: false, res: jsonErr("No organisation linked") };
  }
  const roles: string[] =
    Array.isArray((profile as { roles?: string[] }).roles) &&
    ((profile as { roles?: string[] }).roles?.length ?? 0) > 0
      ? ((profile as { roles?: string[] }).roles as string[])
      : [profile.role ?? ""];
  const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r));
  if (!isAdmin) {
    return {
      ok: false,
      res: jsonErr("Only admins / super admins can update the organisation logo."),
    };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("logo_url")
    .eq("id", profile.org_id)
    .single();

  return {
    ok: true,
    userId: user.id,
    orgId: profile.org_id as string,
    prevLogoPath: (org?.logo_url as string | null) ?? null,
  };
}

export async function POST(request: NextRequest) {
  const auth = await guard();
  if (!auth.ok) return auth.res;

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
  if (file.size === 0) return jsonErr("The selected file is empty.");
  if (file.size > 2 * 1024 * 1024) {
    return jsonErr(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — over the 2 MB logo limit.`);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonErr(`"${file.name}" is ${file.type || "an unsupported type"}. Use PNG, JPG, WEBP, or SVG.`);
  }

  const ensured = await ensureOrgLogosBucket();
  if (ensured.error) return jsonErr(ensured.error);

  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const path = `${auth.orgId}/logo-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from("org-logos")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadErr) return jsonErr(`Storage upload failed: ${uploadErr.message}`);

  // Update organizations.logo_url — use admin client because RLS on
  // organizations doesn't let arbitrary org members UPDATE (only admins
  // usually, depending on project policy). The role gate above has
  // already verified the caller is admin-level.
  const { error: dbErr } = await admin
    .from("organizations")
    .update({ logo_url: path, updated_at: new Date().toISOString() })
    .eq("id", auth.orgId);
  if (dbErr) {
    // Best-effort cleanup of the blob.
    await admin.storage.from("org-logos").remove([path]).catch(() => {});
    return jsonErr(`Database update failed: ${dbErr.message}`);
  }

  // Clean up the previous logo if there was one — avoids stale blobs
  // accumulating in storage every time the user uploads a new logo.
  if (auth.prevLogoPath && auth.prevLogoPath !== path) {
    await admin.storage.from("org-logos").remove([auth.prevLogoPath]).catch(() => {});
  }

  const { data: signed } = await admin.storage
    .from("org-logos")
    .createSignedUrl(path, 60 * 60);

  return jsonOk({ logo_url: path, signedUrl: signed?.signedUrl ?? null });
}

export async function DELETE() {
  const auth = await guard();
  if (!auth.ok) return auth.res;

  const admin = createAdminClient();
  // Clear the DB pointer first, then delete the blob. If storage
  // removal fails, we'd rather leak a file than leave a dangling
  // reference to a missing blob.
  const { error: dbErr } = await admin
    .from("organizations")
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq("id", auth.orgId);
  if (dbErr) return jsonErr(`Database update failed: ${dbErr.message}`);

  if (auth.prevLogoPath) {
    await admin.storage.from("org-logos").remove([auth.prevLogoPath]).catch(() => {});
  }
  return jsonOk();
}
