// Notifications loading skeleton — shown while the notifications server
// component fetches alerts from Supabase.

import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-6">
      <TableSkeleton rows={10} />
    </div>
  );
}
