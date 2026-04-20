// Dashboard loading skeleton — shown by Next.js while the dashboard server
// component is streaming. Mirrors the real layout so the page doesn't "jump"
// when data arrives: 4 KPI cards, 2 charts side by side, then a table.

import {
  KPICardSkeleton,
  ChartSkeleton,
  TableSkeleton,
} from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* KPI cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KPICardSkeleton key={i} />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>

      {/* Recent activity table */}
      <TableSkeleton rows={5} />
    </div>
  );
}
