"use client";
// CampaignPhotosTab — the "Photos" tab on the campaign detail page.
// Shows one photo row per campaign_site, lets authorised users upload
// images, and feeds the same site_photos table the site detail page
// reads from (so uploads here ALSO appear in that site's gallery).
//
// Permission model mirrors the API route: the campaign's creator can
// always upload; admins / managers / executives can too. Anyone in the
// org can view.
//
// Delete / set-primary are deliberately NOT surfaced here — those
// mutations belong on the site page where the full gallery lives.
// That avoids accidental deletes from the campaign view when photos
// are shared with other campaigns booking the same site later.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import {
  Camera,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SitePhoto } from "@/lib/types/database";

// Compact per-row site info we need to render the group header + drive
// uploads. The campaign detail page assembles this from campaign_sites
// joined with sites, then passes it down.
export interface CampaignPhotoSiteRow {
  campaign_site_id: string;
  site_id: string;
  site_name: string;
  site_code: string | null;
  city: string | null;
}

// A photo row joined to its signed URL. The detail page pre-signs URLs
// server-side so the tab opens without a client-side round-trip.
export interface CampaignPhotoItem extends Pick<
  SitePhoto,
  "id" | "site_id" | "campaign_site_id" | "photo_url" | "created_at"
> {
  signedUrl: string | null;
}

interface Props {
  campaignId: string;
  sites: CampaignPhotoSiteRow[];
  photos: CampaignPhotoItem[];
  canUpload: boolean;
  // Optional — the campaign's creator name, used in the "your duty"
  // nudge so the right person knows it's on them.
  creatorName?: string | null;
}

export function CampaignPhotosTab({
  campaignId,
  sites,
  photos,
  canUpload,
  creatorName,
}: Props) {
  const router = useRouter();

  // Group photos by campaign_site_id for the rendered sections.
  const byCampaignSite = new Map<string, CampaignPhotoItem[]>();
  for (const p of photos) {
    if (!p.campaign_site_id) continue;
    const arr = byCampaignSite.get(p.campaign_site_id) ?? [];
    arr.push(p);
    byCampaignSite.set(p.campaign_site_id, arr);
  }

  const totalUploaded = photos.length;
  const sitesWithPhotos = byCampaignSite.size;
  const pendingSites = sites.length - sitesWithPhotos;

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <Camera className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{totalUploaded}</span>{" "}
            <span className="text-muted-foreground">
              photo{totalUploaded === 1 ? "" : "s"} uploaded
            </span>
          </span>
          {sites.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden />
              {sitesWithPhotos}/{sites.length} sites covered
              {pendingSites > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  {pendingSites} pending
                </span>
              )}
            </span>
          )}
        </div>
        {!canUpload && (
          <p className="text-xs text-muted-foreground">
            Only the campaign creator
            {creatorName ? ` (${creatorName})` : ""}, admins, managers or
            executives can upload photos.
          </p>
        )}
      </div>

      {sites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <ImageIcon
            className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            Add sites to this campaign first — photos are uploaded per site.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sites.map((row) => (
            <SiteRow
              key={row.campaign_site_id}
              row={row}
              campaignId={campaignId}
              photos={byCampaignSite.get(row.campaign_site_id) ?? []}
              canUpload={canUpload}
              onChange={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Per-site row ───────────────────────────────────────────────────────────
// Own its own upload state so multiple rows can upload in parallel
// without stepping on each other's progress indicator.

function SiteRow({
  row,
  campaignId,
  photos,
  canUpload,
  onChange,
}: {
  row: CampaignPhotoSiteRow;
  campaignId: string;
  photos: CampaignPhotoItem[];
  canUpload: boolean;
  onChange: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [, startTransition] = useTransition();
  // Optimistic list so the user sees the new thumbnails before
  // router.refresh() completes. Server state wins on next render.
  const [optimistic, setOptimistic] = useState<CampaignPhotoItem[]>([]);

  async function handleFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? []);
    if (fileRef.current) fileRef.current.value = ""; // reset picker
    if (files.length === 0) return;

    setUploading({ done: 0, total: files.length });
    let done = 0;
    const newOnes: CampaignPhotoItem[] = [];

    await Promise.all(
      files.map(async (file) => {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("campaign_id", campaignId);
        fd.append("campaign_site_id", row.campaign_site_id);
        try {
          const res = await fetch(`/api/sites/${row.site_id}/photos`, {
            method: "POST",
            credentials: "same-origin",
            body: fd,
          });
          const data = await res.json().catch(() => ({}));
          if (data?.error) {
            toast.error(`${file.name}: ${data.error}`);
          } else if (data?.photo) {
            newOnes.push({
              id: data.photo.id,
              site_id: data.photo.site_id,
              campaign_site_id: data.photo.campaign_site_id ?? row.campaign_site_id,
              photo_url: data.photo.photo_url,
              created_at: new Date().toISOString(),
              signedUrl: data.signedUrl ?? null,
            });
          }
        } catch (err) {
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`,
          );
        } finally {
          done += 1;
          setUploading({ done, total: files.length });
        }
      }),
    );

    setUploading(null);
    if (newOnes.length > 0) {
      setOptimistic((prev) => [...prev, ...newOnes]);
      toast.success(
        `${newOnes.length} photo${newOnes.length === 1 ? "" : "s"} uploaded for ${row.site_name}`,
      );
      startTransition(onChange);
    }
  }

  // Dedupe: server photos win; only show optimistic ones not yet in the list.
  const seen = new Set(photos.map((p) => p.id));
  const merged = [...photos, ...optimistic.filter((p) => !seen.has(p.id))];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {row.site_name}
            </h3>
            {row.site_code && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {row.site_code}
              </code>
            )}
            {merged.length > 0 ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                {merged.length} uploaded
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                No photos yet
              </span>
            )}
          </div>
          {row.city && (
            <p className="mt-0.5 text-xs text-muted-foreground">{row.city}</p>
          )}
        </div>
        {canUpload && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={handleFiles}
              disabled={uploading != null}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading != null}
              className="gap-1.5"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {uploading.done}/{uploading.total}
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Upload photos
                </>
              )}
            </Button>
          </div>
        )}
      </header>

      {merged.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {canUpload
              ? "Upload photos from the mounted hoarding — they'll also appear on the site page."
              : "No photos captured for this site yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {merged.map((p) => (
            <PhotoThumb key={p.id} photo={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoThumb({ photo }: { photo: CampaignPhotoItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <a
      href={photo.signedUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-lg border border-border bg-muted"
      title="Open full size"
    >
      {photo.signedUrl && !broken ? (
        <Image
          src={photo.signedUrl}
          alt="Campaign photo"
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 20vw, 15vw"
          className="object-cover transition-transform group-hover:scale-105"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-5 w-5" aria-hidden />
        </div>
      )}
    </a>
  );
}
