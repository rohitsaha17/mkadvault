import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      {/* Tab skeleton */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <TableSkeleton rows={7} cols={7} />
    </div>
  );
}
