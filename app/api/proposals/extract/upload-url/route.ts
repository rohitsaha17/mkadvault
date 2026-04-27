// POST /api/proposals/extract/upload-url
// ───────────────────────────────────────
// Issues a signed upload URL the client can PUT a PDF/PPTX to. The
// browser then uploads directly to Supabase Storage, completely
// bypassing Vercel's serverless body limit (~4.5 MB on Hobby /
// default Pro). Once the upload finishes, the client posts the
// returned filePath to /api/proposals/extract for the actual AI run.
//
// Storage path: {orgId}/_imports/sources/{sessionId}.{ext}
// Bucket:       site-photos (existing — RLS lets the user write
//               anything under their orgId folder; admin client
//               reads it server-side during extraction).

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Mirror the extract route's allowed MIME set + size cap so the user
// can't bypass them by going straight to storage.
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function extFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  return "bin";
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      fileName?: string;
      fileMime?: string;
      fileSize?: number;
    };

    if (!body.fileMime || !ALLOWED_MIMES.has(body.fileMime)) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF or PPTX file." },
        { status: 400 },
      );
    }
    if (typeof body.fileSize === "number" && body.fileSize > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.` },
        { status: 400 },
      );
    }

    // Auth + org scoping. Storage path's first folder must be orgId
    // (existing RLS in migration 023). Even though we use the admin
    // client to mint the signed URL — bypassing RLS — we keep the path
    // org-scoped so the existing read policies + cleanup tooling work.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!profile?.org_id) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }
    const orgId = profile.org_id as string;

    // Rate limit: 10 import-uploads per org per hour. Mints a signed
    // URL costs nothing on its own, but each one ends up triggering
    // an /api/proposals/extract call (5/hour cap) so the math works
    // out: an attacker can't get more uploads-per-hour than they can
    // get extracts.
    const rl = rateLimit({
      key: `extract-upload:${orgId}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: rl.reason ?? "Rate limit exceeded" },
        { status: 429 },
      );
    }

    const sessionId = randomUUID();
    const filePath = `${orgId}/_imports/sources/${sessionId}.${extFor(body.fileMime)}`;

    // createSignedUploadUrl returns a token + URL the browser can PUT
    // bytes to without an Authorization header. The token expires in
    // ~2 hours by default which is plenty for a single upload.
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("site-photos")
      .createSignedUploadUrl(filePath);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Couldn't create upload URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      filePath,
      signedUrl: data.signedUrl,
      token: data.token,
      sessionId,
    });
  } catch (err) {
    console.error("[extract/upload-url] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't create upload URL" },
      { status: 500 },
    );
  }
}
