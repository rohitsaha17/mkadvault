import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
