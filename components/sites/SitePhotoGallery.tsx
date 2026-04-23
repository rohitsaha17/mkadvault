"use client";
// SitePhotoGallery — displays uploaded photos and provides upload/delete/primary
// controls. Clicking a photo opens SitePhotoLightbox (full-size view with
// prev/next arrows + keyboard nav). Calls server actions for mutations; gets
// signed URLs from Supabase Storage.
import { useState, useRef, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Trash2, Star, Loader2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteSitePhoto,
  setSitePrimaryPhoto,
} from "@/app/[locale]/(dashboard)/sites/actions";
import type { SitePhoto } from "@/lib/types/database";
import { SitePhotoLightbox } from "./SitePhotoLightbox";

// Uploads a single file to the JSON photo API and returns the new row
// (or an error string). Kept at module scope so multiple files can be
// uploaded in parallel via Promise.all below.
async function uploadOne(
  siteId: string,
  file: File,
): Promise<
  | { ok: true; photo: SitePhoto; signedUrl: string | null }
  | { ok: false; error: string; fileName: string }
> {
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`/api/sites/${siteId}/photos`, {
      method: "POST",
      credentials: "same-origin",
      body: fd,
    });
  } catch (err) {
    return {
      ok: false,
      fileName: file.name,
      error: err instanceof Error ? `Network error: ${err.message}` : "Network error",
    };
  }

  let data: {
    success?: boolean;
    photo?: SitePhoto;
    signedUrl?: string | null;
    error?: string;
  } = {};
  try {
    data = await res.json();
  } catch {
    return {
      ok: false,
      fileName: file.name,
      error: `Server returned non-JSON (HTTP ${res.status})`,
    };
  }
  if (data.error || !data.photo) {
    return {
      ok: false,
      fileName: file.name,
      error: data.error ?? "Upload failed",
    };
  }
  return { ok: true, photo: data.photo, signedUrl: data.signedUrl ?? null };
}

interface Props {
  siteId: string;
  photos: SitePhoto[];
  // Map of {storagePath → signedUrl} for each existing photo. The site-photos
  // bucket is PRIVATE, so we can't construct public URLs — the parent server
  // component generates signed URLs via lib/supabase/signed-urls.ts.
  signedUrls: Record<string, string>;
}

export function SitePhotoGallery({ siteId, photos: initialPhotos, signedUrls: initialSignedUrls }: Props) {
  const router = useRouter();
  const [photos, setPhotos] = useState(initialPhotos);
  // Extra signed URLs that came back from fresh uploads. We merge this
  // into the parent-provided map so just-uploaded photos render
  // immediately without waiting for router.refresh to re-run the server
  // query that generates signed URLs.
  const [extraSignedUrls, setExtraSignedUrls] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lightbox state — which photo index is open (null = closed).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  function getPhotoUrl(storagePath: string): string | null {
    return extraSignedUrls[storagePath] ?? initialSignedUrls[storagePath] ?? null;
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    // Reset the input immediately so the same file can be re-selected
    // if the user wants to retry after an error.
    if (fileRef.current) fileRef.current.value = "";

    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });

    // Fire all uploads in parallel and track completion individually so
    // we can show progress. Each upload is independent — one failure
    // doesn't cascade.
    let completed = 0;
    const promises = files.map(async (file) => {
      const res = await uploadOne(siteId, file);
      completed += 1;
      setUploadProgress({ done: completed, total: files.length });
      return res;
    });

    const results = await Promise.all(promises);

    const successes: { photo: SitePhoto; signedUrl: string | null }[] = [];
    const failures: { fileName: string; error: string }[] = [];
    for (const r of results) {
      if (r.ok) successes.push({ photo: r.photo, signedUrl: r.signedUrl });
      else failures.push({ fileName: r.fileName, error: r.error });
    }

    // Merge new signed URLs so the gallery can render the thumbnails
    // immediately.
    if (successes.length > 0) {
      setPhotos((prev) => [...prev, ...successes.map((s) => s.photo)]);
      setExtraSignedUrls((prev) => {
        const next = { ...prev };
        for (const s of successes) {
          if (s.signedUrl) next[s.photo.photo_url] = s.signedUrl;
        }
        return next;
      });
    }

    setUploading(false);
    setUploadProgress(null);

    if (successes.length > 0) {
      toast.success(
        `${successes.length} photo${successes.length > 1 ? "s" : ""} uploaded`,
      );
      // Background refresh so server-rendered components (counts,
      // primary-photo thumbnail elsewhere) catch up — doesn't block
      // this render because we've already optimistically updated state.
      router.refresh();
    }
    for (const f of failures) {
      toast.error(`${f.fileName}: ${f.error}`);
    }
  }

  function handleDelete(photoId: string) {
    startTransition(async () => {
      const result = await deleteSitePhoto(photoId, siteId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      toast.success("Photo removed");
    });
  }

  function handleSetPrimary(photoId: string) {
    startTransition(async () => {
      const result = await setSitePrimaryPhoto(photoId, siteId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPhotos((prev) =>
        prev.map((p) => ({ ...p, is_primary: p.id === photoId }))
      );
      toast.success("Primary photo updated");
    });
  }

  // Photos in the order they'll be shown — primary first, matches the
  // ordering we pass to the lightbox so `lightboxIndex` lines up.
  const sortedPhotos = [...photos].sort(
    (a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0),
  );

  return (
    <div className="space-y-4">
      {/* Upload button */}
      <div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={handleUpload}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || isPending}
          className="gap-2"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {uploading
            ? uploadProgress
              ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
              : "Uploading…"
            : "Upload Photos"}
        </Button>
        <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP · max 5 MB each</p>
      </div>

      {/* Gallery grid */}
      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border rounded-lg">
          <ImageOff className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No photos uploaded yet</p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-2 text-xs text-blue-600 hover:underline"
          >
            Upload the first photo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {sortedPhotos.map((photo, idx) => (
              <div
                key={photo.id}
                className="relative group rounded-lg overflow-hidden border border-border aspect-video bg-muted"
              >
                {/* Click the image to open the full-size lightbox. The
                    overlay action buttons are still reachable because they
                    stop propagation on click. */}
                <button
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  aria-label="Open photo"
                  className="absolute inset-0 z-[1]"
                >
                  {getPhotoUrl(photo.photo_url) ? (
                    <Image
                      src={getPhotoUrl(photo.photo_url)!}
                      alt="Site photo"
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                      unoptimized
                    />
                  ) : (
                    // Signed URL not yet available (e.g. freshly uploaded photo
                    // before router.refresh completes). Show placeholder.
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                </button>

                {/* Primary badge */}
                {photo.is_primary && (
                  <div className="pointer-events-none absolute top-1.5 left-1.5 z-[2] bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <Star className="h-3 w-3 fill-current" />
                    Primary
                  </div>
                )}

                {/* Hover actions */}
                <div className="pointer-events-none absolute inset-0 z-[2] bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  {!photo.is_primary && (
                    <button
                      type="button"
                      title="Set as primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetPrimary(photo.id);
                      }}
                      disabled={isPending}
                      className="pointer-events-auto bg-white/90 rounded-md p-1.5 text-foreground hover:bg-white transition"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Remove photo"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(photo.id);
                    }}
                    disabled={isPending}
                    className="pointer-events-auto bg-red-500/90 rounded-md p-1.5 text-white hover:bg-red-600 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Lightbox — mounted lazily once the user clicks a photo. We only
          have this one site here, so no prev/next site navigation. */}
      {lightboxIndex !== null && (
        <SitePhotoLightbox
          open={lightboxIndex !== null}
          onOpenChange={(o) => {
            if (!o) setLightboxIndex(null);
          }}
          siteIds={[siteId]}
          initialSiteIndex={0}
          initialPhotoIndex={lightboxIndex}
        />
      )}
    </div>
  );
}
