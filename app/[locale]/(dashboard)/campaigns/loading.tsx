import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      {/* Filter bar skeleton */}
      <div className="flex gap-3 flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
