"use client";
// SiteThumbnailButton — renders a small square thumbnail in the sites list
// table. Clicking it opens SitePhotoLightbox — a gallery dialog that shows
// every photo for the site, with prev/next navigation both between photos
// and between sites (so the user can quickly browse the whole list without
// reopening the modal for each row).
//
// The list page passes the full ordered list of visible site IDs + a
// siteId → name map so the lightbox can render "Site 3 of 20" + a header
// without an extra round-trip when navigating between sites.
import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { SitePhotoLightbox } from "./SitePhotoLightbox";

interface Props {
  // The signed URL for this site's primary photo. null when no photo.
  signedUrl: string | null;
  siteName: string;
  // All siteIds visible on this page, in order. Used for prev/next site
  // navigation inside the lightbox.
  siteIds: string[];
  // Index into siteIds pointing at this row's site.
  siteIndex: number;
  // Optional lookup for display names when navigating to a different site.
  siteNameById?: Record<string, string>;
}

export function SiteThumbnailButton({
  signedUrl,
  siteName,
  siteIds,
  siteIndex,
  siteNameById,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {signedUrl ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open photos for ${siteName}`}
          className="relative h-12 w-12 overflow-hidden rounded-md border border-border bg-muted hover:ring-2 hover:ring-primary transition"
        >
          <Image
            src={signedUrl}
            alt={`Thumbnail of ${siteName}`}
            fill
            className="object-cover"
            sizes="48px"
            unoptimized
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open photos for ${siteName}`}
          className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground hover:ring-2 hover:ring-primary transition"
        >
          <ImageOff className="h-4 w-4" />
        </button>
      )}

      <SitePhotoLightbox
        open={open}
        onOpenChange={setOpen}
        siteIds={siteIds}
        initialSiteIndex={siteIndex}
        siteNameById={siteNameById}
      />
    </>
  );
}
