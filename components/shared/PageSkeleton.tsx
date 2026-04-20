// PageSkeleton — loading placeholder components used while server data is fetching.
// Theme-aware (uses bg-card / bg-muted) so it blends with both light and dark modes.
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ─── KPI Card skeleton ────────────────────────────────────────────────────────

export function KPICardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 card-elevated h-32 flex flex-col justify-between",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

// ─── Table skeleton ───────────────────────────────────────────────────────────

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function TableSkeleton({ rows = 6, cols = 5, className }: TableSkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card card-elevated overflow-hidden",
        className
      )}
    >
      <div className="flex gap-4 border-b border-border bg-muted/40 px-5 py-3.5">
        {Array.from({ length: cols }).map((_, colIdx) => (
          <Skeleton key={colIdx} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex gap-4 border-b border-border last:border-b-0 px-5 py-4"
        >
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={cn(
                "h-3.5 flex-1",
                colIdx === 0 && "max-w-[160px]",
                colIdx === cols - 1 && "max-w-[80px]"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Chart skeleton ───────────────────────────────────────────────────────────

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 card-elevated",
        className
      )}
    >
      <div className="mb-4 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

// ─── Detail header skeleton ───────────────────────────────────────────────────

export function DetailHeaderSkeleton() {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-5 mb-6">
      <div className="space-y-3 flex-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
  );
}
