"use client";
// SitePhotoLightbox — a shared photo gallery dialog.
//
// Two use cases:
//   1. From the site detail gallery: click a photo → open lightbox for
//      that site. No site navigation needed (pass `siteIds={[currentId]}`).
//   2. From the sites list thumbnail: click a thumbnail → open lightbox
//      with prev/next site navigation (pass the full visible siteIds list).
//
// Photos for the active site are loaded lazily via a server action, so
// the list page doesn't have to pre-sign every photo for every site.
// Keyboard shortcuts (while the dialog is open):
//   ← / →       previous / next photo within the current site
//   Shift+← / → previous / next site
//   Esc         close (handled by the Dialog itself)
//
// The parent controls `open` / `onOpenChange`. The component mounts its
// inner state only while open — so each open starts fresh with the
// supplied initial indices and we avoid the "reset props in effect"
// anti-pattern.
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getSitePhotosWithSignedUrls } from "@/app/[locale]/(dashboard)/sites/actions";

type Photo = {
  id: string;
  photo_url: string;
  photo_type: string;
  is_primary: boolean;
  sort_order: number;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The ordered list of siteIds this lightbox can cycle through. For the
  // detail page this is typically `[thisSiteId]`; for the list it's every
  // site visible on the current page.
  siteIds: string[];
  // Index into siteIds that the lightbox should open on.
  initialSiteIndex: number;
  // Optional index into that site's photos to open on (defaults to 0).
  initialPhotoIndex?: number;
  // Optional map of {siteId → siteName} to avoid an extra round-trip for
  // the header label. If not supplied, we'll fall back to the name returned
  // by the server action.
  siteNameById?: Record<string, string>;
}

export function SitePhotoLightbox(props: Props) {
  // Only mount the body (with all its state + effects) while the dialog is
  // open. This lets us reset cleanly from props without a cascade effect.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <LightboxBody {...props} /> : null}
    </Dialog>
  );
}

function LightboxBody({
  onOpenChange,
  siteIds,
  initialSiteIndex,
  initialPhotoIndex = 0,
  siteNameById,
}: Props) {
  const [siteIndex, setSiteIndex] = useState(initialSiteIndex);
  const [photoIndex, setPhotoIndex] = useState(initialPhotoIndex);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loadedSiteName, setLoadedSiteName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentSiteId = siteIds[siteIndex] ?? null;
  const canPrevSite = siteIndex > 0;
  const canNextSite = siteIndex < siteIds.length - 1;

  // Fetch photos for the currently-selected site. Rerun whenever the user
  // navigates to a different site.
  useEffect(() => {
    if (!currentSiteId) return;
    let cancelled = false;

    async function load(siteId: string) {
      try {
        const res = await getSitePhotosWithSignedUrls(siteId);
        if (cancelled) return;
        if (res.error || !res.photos) {
          setError(res.error ?? "Failed to load photos.");
          setPhotos([]);
          setSignedUrls({});
          setLoadedSiteName(null);
        } else {
          const photoList = res.photos;
          setError(null);
          setPhotos(photoList);
          setSignedUrls(res.signedUrls ?? {});
          setLoadedSiteName(res.siteName ?? null);
          setPhotoIndex((prev) => (prev < photoList.length ? prev : 0));
        }
      } catch {
        if (!cancelled) setError("Failed to load photos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load(currentSiteId);
    return () => {
      cancelled = true;
    };
  }, [currentSiteId]);

  const goPrevPhoto = useCallback(() => {
    setPhotoIndex((i) => (photos.length === 0 ? 0 : (i - 1 + photos.length) % photos.length));
  }, [photos.length]);

  const goNextPhoto = useCallback(() => {
    setPhotoIndex((i) => (photos.length === 0 ? 0 : (i + 1) % photos.length));
  }, [photos.length]);

  const goPrevSite = useCallback(() => {
    if (!canPrevSite) return;
    setSiteIndex((i) => i - 1);
    setPhotoIndex(0);
    setLoading(true);
  }, [canPrevSite]);

  const goNextSite = useCallback(() => {
    if (!canNextSite) return;
    setSiteIndex((i) => i + 1);
    setPhotoIndex(0);
    setLoading(true);
  }, [canNextSite]);

  // Keyboard navigation while the dialog is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) goPrevSite();
        else goPrevPhoto();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) goNextSite();
        else goNextPhoto();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrevPhoto, goNextPhoto, goPrevSite, goNextSite]);

  const currentPhoto = photos[photoIndex] ?? null;
  const currentUrl = currentPhoto ? signedUrls[currentPhoto.photo_url] ?? null : null;
  const displayName =
    (currentSiteId && siteNameById?.[currentSiteId]) || loadedSiteName || "Photos";
  const hasSiteNav = siteIds.length > 1;

  return (
    <DialogContent
      showCloseButton={false}
      className="p-0 sm:max-w-4xl bg-background overflow-hidden"
    >
      <DialogTitle className="sr-only">{displayName} — photos</DialogTitle>
      <DialogDescription className="sr-only">
        Use left and right arrow keys to move between photos; hold shift to
        jump to the previous or next site.
      </DialogDescription>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {displayName}
          </p>
          <p className="text-xs text-muted-foreground">
            {photos.length > 0
              ? `Photo ${photoIndex + 1} of ${photos.length}`
              : loading
              ? "Loading…"
              : "No photos"}
            {hasSiteNav && (
              <span className="ml-2 opacity-60">
                · Site {siteIndex + 1} of {siteIds.length}
              </span>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Main image area */}
      <div className="relative bg-muted/40 flex items-center justify-center aspect-[4/3] sm:aspect-[16/10]">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : currentUrl ? (
          <Image
            src={currentUrl}
            alt={`${displayName} — photo ${photoIndex + 1}`}
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 896px"
            unoptimized
            priority
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <p className="text-sm">No photos uploaded for this site.</p>
          </div>
        )}

        {/* Photo nav arrows — only visible when there are multiple photos */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrevPhoto}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 shadow-sm hover:bg-background transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goNextPhoto}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 shadow-sm hover:bg-background transition"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3 border-t border-border">
          {photos.map((p, i) => {
            const url = signedUrls[p.photo_url];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPhotoIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md border transition ${
                  i === photoIndex
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {url ? (
                  <Image
                    src={url}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="80px"
                    unoptimized
                  />
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Site nav footer — only when there are multiple sites */}
      {hasSiteNav && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={goPrevSite}
            disabled={!canPrevSite}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous site
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={goNextSite}
            disabled={!canNextSite}
          >
            Next site
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </DialogContent>
  );
}
