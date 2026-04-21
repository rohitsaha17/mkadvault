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
  uploadSitePhoto,
  deleteSitePhoto,
  setSitePrimaryPhoto,
} from "@/app/[locale]/(dashboard)/sites/actions";
import type { SitePhoto } from "@/lib/types/database";
import { SitePhotoLightbox } from "./SitePhotoLightbox";

interface Props {
  siteId: string;
  photos: SitePhoto[];
  // Map of {storagePath → signedUrl} for each existing photo. The site-photos
  // bucket is PRIVATE, so we can't construct public URLs — the parent server
  // component generates signed URLs via lib/supabase/signed-urls.ts.
  signedUrls: Record<string, string>;
}

export function SitePhotoGallery({ siteId, photos: initialPhotos, signedUrls }: Props) {
  const router = useRouter();
  const [photos, setPhotos] = useState(initialPhotos);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lightbox state — which photo index is open (null = closed).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  function getPhotoUrl(storagePath: string): string | null {
    return signedUrls[storagePath] ?? null;
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    setUploading(true);
    let uploadedCount = 0;
    // Collect successful uploads then append in one go so the gallery
    // updates immediately — no page refresh required.
    const newPhotos: SitePhoto[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadSitePhoto(siteId, formData);
      if (result.error) {
        toast.error(result.error);
        continue;
      }
      if (result.photo) {
        newPhotos.push(result.photo as SitePhoto);
        uploadedCount++;
      }
    }
    if (newPhotos.length > 0) {
      setPhotos((prev) => [...prev, ...newPhotos]);
    }
    setUploading(false);
    if (uploadedCount > 0) {
      toast.success(`${uploadedCount} photo${uploadedCount > 1 ? "s" : ""} uploaded`);
      // Refresh the server component tree so any other parts of the page
      // (e.g. photo count headings) stay in sync.
      router.refresh();
    }
    // Reset input
    if (fileRef.current) fileRef.current.value = "";
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
          {uploading ? "Uploading…" : "Upload Photos"}
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
