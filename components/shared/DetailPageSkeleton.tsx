// DetailPageSkeleton — generic placeholder for any [id] detail page.
// Renders a header with title/status + 2-column info grid + a secondary card,
// which matches the shape of most detail pages in the app.
import { Skeleton } from "@/components/ui/skeleton";
import { DetailHeaderSkeleton } from "./PageSkeleton";

export function DetailPageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <DetailHeaderSkeleton />
      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 rounded-2xl border border-border bg-card card-elevated p-6 space-y-4">
          <Skeleton className="h-4 w-40" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-3">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card card-elevated p-6 space-y-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
