// Billing → Invoices loading skeleton — shown while the invoices server
// component fetches invoice data from Supabase.

import { TableSkeleton } from "@/components/shared/PageSkeleton";

export default function Loading() {
  return (
    <div className="p-6">
      <TableSkeleton rows={6} />
    </div>
  );
}
