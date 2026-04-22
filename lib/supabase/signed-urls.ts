// Signed-URL helpers for private Supabase Storage buckets.
//
// Our storage buckets are private, so we can't just construct
// "{SUPABASE_URL}/storage/v1/object/public/..." URLs — those return 403.
// Instead, each render generates short-lived signed URLs that the browser
// can fetch directly until they expire.
//
// These helpers run in server components and server actions. They use the
// per-request Supabase client so RLS on storage.objects is enforced.

import { createClient } from "./server";

// Default expiry for signed URLs generated during a page render. 1 hour is
// long enough to cover browsing + editing, short enough that a leaked URL
// doesn't become a long-term exfil risk.
const DEFAULT_EXPIRY_SECONDS = 60 * 60;

/**
 * Return a map of {storagePath → signedUrl} for each path supplied.
 * Paths that can't be signed (missing object, permission error) are
 * omitted from the result. Order and duplicates in the input list are
 * collapsed automatically.
 */
export async function getSignedUrls(
  bucket: string,
  paths: string[],
  expiresIn: number = DEFAULT_EXPIRY_SECONDS
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(unique, expiresIn);

  if (error || !data) {
    console.error(`[signed-urls] bucket=${bucket} failed:`, error);
    return {};
  }

  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.signedUrl && row.path) {
      out[row.path] = row.signedUrl;
    }
  }
  return out;
}

/** Shortcut for a single path. Returns null if the URL can't be signed. */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = DEFAULT_EXPIRY_SECONDS
): Promise<string | null> {
  if (!path) return null;
  const map = await getSignedUrls(bucket, [path], expiresIn);
  return map[path] ?? null;
}
