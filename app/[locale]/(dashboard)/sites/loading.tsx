// Sites loading skeleton — shown while the sites server component fetches
// the site list from Supabase.

import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-6">
      <TableSkeleton rows={6} />
    </div>
  );
}
