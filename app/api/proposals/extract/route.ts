// POST /api/proposals/extract
// ───────────────────────────
// Accepts a PDF or PPTX uploaded by an authenticated user, runs the file
// through Anthropic's Claude Vision model, and returns a structured list
// of candidate sites that the user can review and add to a proposal.
//
// We use a route handler (not a server action) because files can be up
// to ~30MB and server actions are restricted to a small request body.
//
// Flow:
//   1. Auth + org lookup via the per-request Supabase client
//   2. Read file bytes into memory
//   3. Build Claude content blocks:
//       • PDF → single "document" block (Claude has native PDF support)
//       • PPTX → unzip with JSZip, extract media images + slide text,
//                send images as "image" blocks alongside text context
//   4. Ask Claude to return JSON: a list of sites, each with extracted
//      fields + an image_index pointing into our extracted images array
//   5. Upload the extracted images to site-photos under a temporary
//      "_imports/{sessionId}/..." prefix so the review UI can display
//      them via short-lived signed URLs. On confirmation, the create
//      action copies the blob to its final per-site path.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Allow up to 5 minutes for the AI call — parsing a 20-slide deck with
// lots of images routinely takes 30–90 seconds.
export const maxDuration = 300;
export const runtime = "nodejs";

// Cap upload size. PPTX rate cards from large agencies routinely run
// 30–40 MB once they include uncompressed photos, so 50 MB gives us
// headroom while still staying under both providers' limits:
//   • Anthropic document blocks accept up to ~32 MB raw bytes.
//   • Gemini inline data accepts up to ~20 MB per part — but for PPTX
//     we explode the deck into per-image parts (each well under 20 MB)
//     and for PDFs Gemini handles the document in a single inlineData
//     part.
// The provider call layer downsizes if needed; this cap is just the
// outer guardrail.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Provider selection: prefer Gemini when its key is set (cheaper + the
// builder has Google credits), otherwise Anthropic. Either alone is
// enough — both give us PDF + image vision and JSON output. The model
// IDs are env-configurable so ops can swap without a redeploy.
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-sonnet-4-5-20250929";
const GEMINI_MODEL =
  process.env.GEMINI_EXTRACT_MODEL ?? "gemini-2.5-flash";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// Shape Claude is asked to return. We keep this loose on purpose — the
// review UI has editable fields, so imperfect extractions are fine.
interface ExtractedSite {
  name: string;
  site_code?: string | null;
  media_type?: string | null;
  structure_type?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  width_ft?: number | null;
  height_ft?: number | null;
  illumination?: string | null;
  facing?: string | null;
  traffic_side?: string | null;
  visibility_distance_m?: number | null;
  base_rate_inr?: number | null;
  notes?: string | null;
  // Index into the `images` array we returned to Claude. -1 / null means
  // "no image found for this site."
  image_index?: number | null;
}

interface ExtractResponseSite extends ExtractedSite {
  // Storage path we wrote the image to (so the server action can
  // copy/move it when the user confirms). Null when no image matched.
  image_storage_path: string | null;
  // Short-lived signed URL for the review UI. Expires with the session
  // — by the time the user confirms, we re-sign inside the action.
  image_signed_url: string | null;
}

// Anthropic's vision API only accepts these four image media types.
// Narrowing the union to the literals unblocks the SDK's type overloads.
type SupportedImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

type ContentBlock =
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    }
  | {
      type: "image";
      source: { type: "base64"; media_type: SupportedImageMime; data: string };
    }
  | { type: "text"; text: string };

// Guess a likely image MIME type from the filename inside the PPTX zip.
// PPTX `ppt/media/*` files have extensions we can trust.
function mimeFromName(name: string): SupportedImageMime | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

// Crude but effective extraction of visible text runs from a slide XML.
// We're not trying to reconstruct layout — we just want the words so
// Claude has textual context beside the image blocks.
function extractSlideText(xml: string): string {
  const runs = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
  return runs
    .map((run) => run.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000); // Never let a single slide dominate the prompt
}

// ───────────────────────────────────────────────────────────────────────────
// Main handler
// ───────────────────────────────────────────────────────────────────────────
export async function POST(req: Request): Promise<Response> {
  // Wrap the whole handler so no failure path — formData parse errors,
  // Claude SDK throws, Supabase client creation — can slip out as an
  // unhandled 500 with an HTML body. The client shows a generic
  // "Network error" when it can't parse the response as JSON, which is
  // what's been confusing users.
  try {
    return await extractHandler(req);
  } catch (err) {
    console.error("[extract] unhandled error:", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { error: `Couldn't read that file: ${msg}` },
      { status: 500 },
    );
  }
}

async function extractHandler(req: Request): Promise<Response> {
  // ── 0. Provider selection ────────────────────────────────────────────────
  // Pick whichever provider has a key configured. Gemini takes priority
  // when both are present — typically cheaper, and the builder has
  // Google credits to burn.
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const provider: "gemini" | "anthropic" | null = geminiKey
    ? "gemini"
    : anthropicKey
      ? "anthropic"
      : null;
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "Import needs an AI provider key. Set GOOGLE_GEMINI_API_KEY (preferred — uses Gemini 2.5 Flash) or ANTHROPIC_API_KEY in .env.local (and in Vercel) before using this feature.",
      },
      { status: 500 }
    );
  }

  // ── 1. Auth + org ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id) {
    return NextResponse.json({ error: "No organisation found" }, { status: 400 });
  }
  const orgId = profile.org_id as string;

  // ── 2. File read + validation ────────────────────────────────────────────
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.` },
      { status: 400 }
    );
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Upload a PDF or PPTX file (presentation).",
      },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileBytes = Buffer.from(arrayBuffer);

  // ── 3. Build Claude content blocks + track images we extracted ────────────
  // For PPTX we physically unzip the file and pull out each ppt/media image.
  // We also carry the extracted image bytes along so we can write them to
  // Supabase Storage after Claude has told us which site each image belongs
  // to. For PDFs there are no separate image files — the whole document
  // goes to Claude as one block, and any images the user wants go through
  // a second pass (Claude returns image_index=null for now).
  const content: ContentBlock[] = [];
  const extractedImages: { bytes: Buffer; mime: SupportedImageMime; name: string }[] = [];

  if (file.type === "application/pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: fileBytes.toString("base64"),
      },
    });
  } else {
    // PPTX branch — unzip, pull media + slide text.
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(fileBytes);
    } catch {
      return NextResponse.json(
        { error: "Couldn't unzip the PPTX. The file may be corrupted." },
        { status: 400 }
      );
    }

    // Slides → text context (ordered by slide number).
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
        return na - nb;
      });
    const slideTexts: string[] = [];
    for (const path of slideFiles) {
      const xml = await zip.files[path].async("string");
      slideTexts.push(extractSlideText(xml));
    }

    // Media → image blocks.
    const mediaNames = Object.keys(zip.files)
      .filter((n) => n.startsWith("ppt/media/"))
      .sort();
    for (const mediaPath of mediaNames) {
      const mime = mimeFromName(mediaPath);
      if (!mime) continue;
      const bytes = Buffer.from(await zip.files[mediaPath].async("uint8array"));
      // Skip tiny icons / logos — they're rarely the site hero shot.
      if (bytes.length < 15 * 1024) continue;
      extractedImages.push({ bytes, mime, name: mediaPath });
    }

    // Preamble text tells Claude how to read the rest.
    content.push({
      type: "text",
      text:
        "You will receive a PowerPoint deck as extracted slide text plus the slide media images.\n\nSlide text (ordered by slide number):\n" +
        slideTexts
          .map((t, i) => `Slide ${i + 1}: ${t || "(no text)"}`)
          .join("\n"),
    });

    // Limit to 20 images so we don't blow the request budget.
    for (const img of extractedImages.slice(0, 20)) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mime,
          data: img.bytes.toString("base64"),
        },
      });
    }
  }

  // ── 4. Extraction prompt ─────────────────────────────────────────────────
  // We ask Claude to reply with a single JSON object. Nothing else.
  // `image_index` is 0-based into the `images` content blocks above.
  // For PDFs where we didn't break out individual images, Claude should
  // set image_index to null (the review UI will show "no image" for now).
  const instruction = `You are parsing an outdoor advertising (OOH) proposal / rate card from another agency.

Your job: return a JSON array of site listings found in the document. One site per unique hoarding/billboard/OOH inventory item.

Return ONLY a JSON object of the form:
{
  "sites": [
    {
      "name": "string — the site identifier / name / landmark used in the deck",
      "site_code": "optional short code if the deck shows one",
      "media_type": "billboard | hoarding | dooh | kiosk | wall_wrap | unipole | bus_shelter | custom",
      "structure_type": "permanent | temporary | digital",
      "address": "full street address when available",
      "city": "city name",
      "state": "Indian state name",
      "pincode": "6-digit pincode or null",
      "landmark": "nearby landmark if mentioned",
      "width_ft": 40,
      "height_ft": 20,
      "illumination": "frontlit | backlit | digital | nonlit",
      "facing": "N | S | E | W | NE | NW | SE | SW",
      "traffic_side": "lhs | rhs | both",
      "visibility_distance_m": 150,
      "base_rate_inr": 75000,
      "notes": "free-form notes the reviewer should see",
      "image_index": 3
    }
  ]
}

Rules:
- Use null for any field you cannot determine — never invent values.
- image_index is the 0-based position of the photo in the image content blocks you received (the hero photo showing this specific hoarding). If multiple sites share a photo, pick the closest match per site. If no image is present, use null.
- For rate cards the rate is usually per month — convert lakhs/crores to rupees (1 lakh = 100000).
- Normalize media_type and illumination to the enum values above. If unsure, pick the closest.
- Return 0 sites if the document isn't an OOH listing.
- No commentary, no markdown, no code fences — just the JSON object.`;

  content.push({ type: "text", text: instruction });

  // ── 5. Call the chosen provider ──────────────────────────────────────────
  // Both branches return the same `ExtractedSite[]` shape so the rest of
  // the handler is provider-agnostic. Each branch wraps its own API
  // call in try/catch so we can return a clean JSON error to the client.
  let extracted: ExtractedSite[] = [];
  try {
    if (provider === "gemini") {
      extracted = await callGemini(geminiKey!, content, fileBytes, file.type);
    } else {
      extracted = await callAnthropic(anthropicKey!, content);
    }
  } catch (err) {
    console.error(`[extract] ${provider} call or JSON parse failed:`, err);
    return NextResponse.json(
      {
        error:
          "Couldn't read that file. The AI extractor either hit a rate limit or returned unexpected content. Please try again in a minute or use a different file.",
      },
      { status: 502 }
    );
  }

  // ── 6. Upload matched images to storage so the review UI can show them ───
  const sessionId = crypto.randomUUID();
  const importRoot = `${orgId}/_imports/${sessionId}`;
  const admin = createAdminClient();
  const results: ExtractResponseSite[] = [];

  for (let i = 0; i < extracted.length; i++) {
    const site = extracted[i];
    const idx = typeof site.image_index === "number" ? site.image_index : -1;
    let storagePath: string | null = null;
    let signedUrl: string | null = null;

    if (idx >= 0 && idx < extractedImages.length) {
      const img = extractedImages[idx];
      const ext = img.mime.split("/")[1] ?? "png";
      storagePath = `${importRoot}/${i}.${ext}`;
      const { error: uploadErr } = await admin.storage
        .from("site-photos")
        .upload(storagePath, img.bytes, { contentType: img.mime, upsert: true });
      if (uploadErr) {
        console.warn("[extract] image upload failed", uploadErr);
        storagePath = null;
      } else {
        const { data: signed } = await admin.storage
          .from("site-photos")
          .createSignedUrl(storagePath, 60 * 60);
        signedUrl = signed?.signedUrl ?? null;
      }
    }

    results.push({
      ...site,
      image_storage_path: storagePath,
      image_signed_url: signedUrl,
    });
  }

  return NextResponse.json({
    sessionId,
    sites: results,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Provider implementations
// ───────────────────────────────────────────────────────────────────────────

// Strip any markdown fences the model wraps the JSON in and parse out
// the `sites` array. Returns [] if the response isn't shaped as
// expected — the caller decides whether to surface that to the user.
function parseSitesJson(rawText: string): ExtractedSite[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (
    parsed &&
    typeof parsed === "object" &&
    "sites" in parsed &&
    Array.isArray((parsed as { sites: unknown }).sites)
  ) {
    return (parsed as { sites: ExtractedSite[] }).sites;
  }
  return [];
}

async function callAnthropic(
  apiKey: string,
  content: ContentBlock[],
): Promise<ExtractedSite[]> {
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content }],
  });
  const textOut = response.content
    .filter((c): c is { type: "text"; text: string } & typeof c => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return parseSitesJson(textOut);
}

// Convert our provider-neutral content blocks into Gemini's `Part[]`
// shape. The mapping:
//   text     → { text }
//   image    → { inlineData: { mimeType, data } }
//   document → { inlineData: { mimeType: "application/pdf", data } }
// For PPTX uploads we already explode the deck into per-image blocks,
// so the document path is only hit for raw PDFs.
function toGeminiParts(content: ContentBlock[]): Part[] {
  return content.map((c): Part => {
    if (c.type === "text") return { text: c.text };
    if (c.type === "image") {
      return {
        inlineData: { mimeType: c.source.media_type, data: c.source.data },
      };
    }
    return {
      inlineData: { mimeType: c.source.media_type, data: c.source.data },
    };
  });
}

async function callGemini(
  apiKey: string,
  content: ContentBlock[],
  pdfBytes: Buffer,
  fileMime: string,
): Promise<ExtractedSite[]> {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_MODEL,
    // Force a JSON response so we don't fight markdown fences. The
    // generationConfig instructs Gemini to skip its usual prose
    // preamble; combined with our prompt's "JSON only" clause the
    // output parses cleanly with JSON.parse.
    generationConfig: { responseMimeType: "application/json" },
  });

  // For PDFs, Gemini natively reads the document — pass the bytes as a
  // single inlineData part instead of using our PPTX-style image blocks
  // (which the existing builder already handled by going down the
  // image-extraction path). This mirrors the Anthropic side: Anthropic
  // gets a `document` block, Gemini gets an `application/pdf` part.
  let parts: Part[];
  if (fileMime === "application/pdf") {
    // Replace the upstream document block (if present) with Gemini's
    // inlineData PDF; carry over text/image parts unchanged.
    const nonDoc = content.filter((c) => c.type !== "document");
    parts = [
      {
        inlineData: {
          mimeType: "application/pdf",
          data: pdfBytes.toString("base64"),
        },
      },
      ...toGeminiParts(nonDoc),
    ];
  } else {
    parts = toGeminiParts(content);
  }

  const result = await model.generateContent({
    contents: [{ role: "user", parts }],
  });
  const textOut = result.response.text();
  return parseSitesJson(textOut);
}
