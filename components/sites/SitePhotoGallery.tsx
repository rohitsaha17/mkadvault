"use client";
// SitePhotoGallery — displays uploaded photos and provides upload/delete/primary
// controls. Calls server actions for mutations; gets signed URLs from Supabase Storage.
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

interface Props {
  siteId: string;
  photos: SitePhoto[];
  // Supabase Storage public base URL — pass from server component
  storageBaseUrl: string;
}

export function SitePhotoGallery({ siteId, photos: initialPhotos, storageBaseUrl }: Props) {
  const router = useRouter();
  const [photos, setPhotos] = useState(initialPhotos);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function getPhotoUrl(storagePath: string) {
    return `${storageBaseUrl}/site-photos/${storagePath}`;
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

  function handleDelete(photoId: string, _photoName: string) {
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
          {photos
            .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
            .map((photo) => (
              <div
                key={photo.id}
                className="relative group rounded-lg overflow-hidden border border-border aspect-video bg-muted"
              >
                <Image
                  src={getPhotoUrl(photo.photo_url)}
                  alt="Site photo"
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                />

                {/* Primary badge */}
                {photo.is_primary && (
                  <div className="absolute top-1.5 left-1.5 bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <Star className="h-3 w-3 fill-current" />
                    Primary
                  </div>
                )}

                {/* Hover actions */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  {!photo.is_primary && (
                    <button
                      title="Set as primary"
                      onClick={() => handleSetPrimary(photo.id)}
                      disabled={isPending}
                      className="bg-white/90 rounded-md p-1.5 text-foreground hover:bg-white transition"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    title="Remove photo"
                    onClick={() => handleDelete(photo.id, photo.photo_url)}
                    disabled={isPending}
                    className="bg-red-500/90 rounded-md p-1.5 text-white hover:bg-red-600 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
