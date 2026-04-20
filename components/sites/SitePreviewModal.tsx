"use client";

// SitePreviewModal — opens a dialog with a quick-glance summary of a site.
// Fetches data on-demand when the dialog opens so the parent page stays fast.
// Trigger element is passed as `children` (e.g. a table row or button).

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { inr } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getSitePreview } from "@/app/[locale]/(dashboard)/sites/actions";
import { ExternalLink } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SitePreviewModalProps {
  siteId: string;
  children: React.ReactNode;
}

type SiteData = {
  id: string;
  name: string;
  site_code: string;
  city: string;
  state: string;
  address: string;
  media_type: string;
  illumination: string | null;
  width_ft: number | null;
  height_ft: number | null;
  total_sqft: number | null;
  base_rate_paise: number | null;
  status: string;
  facing: string | null;
  traffic_side: string | null;
  landmark: string | null;
};

type PhotoData = {
  id: string;
  photo_url: string;
  photo_type: string;
  is_primary: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Replace underscores with spaces and capitalise the first letter */
function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}


// ─── Sub-components ──────────────────────────────────────────────────────────

/** Label + value pair used throughout the modal */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

/** Skeleton placeholder shown while the server action is in-flight */
function PreviewSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Info grid skeleton */}
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      {/* Photo grid skeleton */}
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SitePreviewModal({ siteId, children }: SitePreviewModalProps) {
  const [site, setSite] = useState<SiteData | null>(null);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch data each time the dialog opens so it's always fresh
  const handleOpenChange = useCallback(
    async (open: boolean) => {
      if (!open) return; // nothing to do on close
      setLoading(true);
      setError(null);
      try {
        const result = await getSitePreview(siteId);
        if (result.error) {
          setError(result.error);
        } else {
          setSite(result.site as SiteData);
          setPhotos((result.photos ?? []) as PhotoData[]);
        }
      } catch {
        setError("Failed to load site preview. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [siteId]
  );

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger>{children}</DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <PreviewSkeleton />
        ) : error ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : site ? (
          <>
            {/* ── Header ──────────────────────────────────────────── */}
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <DialogTitle className="text-lg">{site.name}</DialogTitle>
                  <p className="font-mono text-xs text-muted-foreground">
                    {site.site_code}
                  </p>
                </div>
                <StatusBadge status={site.status} />
              </div>
            </DialogHeader>

            {/* ── Location ────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field
                label="City / State"
                value={`${site.city}, ${site.state}`}
              />
              <Field label="Address" value={site.address || "—"} />
              <Field label="Landmark" value={site.landmark || "—"} />
            </div>

            {/* ── Attributes ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Media Type" value={humanize(site.media_type)} />
              <Field
                label="Illumination"
                value={humanize(site.illumination)}
              />
              <Field label="Facing" value={humanize(site.facing)} />
              <Field
                label="Traffic Side"
                value={humanize(site.traffic_side)}
              />
            </div>

            {/* ── Dimensions & Rate ───────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field
                label="Dimensions"
                value={
                  site.width_ft && site.height_ft
                    ? `${site.width_ft} × ${site.height_ft} ft`
                    : "—"
                }
              />
              <Field
                label="Total Sqft"
                value={site.total_sqft ? `${site.total_sqft} sqft` : "—"}
              />
              <Field
                label="Rate / month"
                value={
                  site.base_rate_paise !== null
                    ? inr(site.base_rate_paise)
                    : "—"
                }
              />
            </div>

            {/* ── Photos ──────────────────────────────────────────── */}
            {photos.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Photos
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-photos/${photo.photo_url}`}
                      alt={`${site.name} — ${humanize(photo.photo_type)}`}
                      className="aspect-video w-full rounded-lg object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Footer action ───────────────────────────────────── */}
            <div className="pt-2">
              <a
                href={`/sites/${site.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                View Full Details
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
