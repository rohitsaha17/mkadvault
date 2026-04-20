// Reports hub loading skeleton — shown while the reports page server
// component fetches the summary counts from Supabase.

import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-6">
      <TableSkeleton rows={8} />
    </div>
  );
}
