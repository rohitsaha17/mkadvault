// Route Handler for soft-deleting a campaign. Matches the pattern in
// /api/campaigns/[id]/cancel — stable URL that survives deploys, calls
// the existing deleteCampaign Server Action internally.
//
// Deletion is SOFT (sets deleted_at) so nothing is truly lost — the
// campaign disappears from the list but invoices, activity log, etc.
// still reference it correctly for historical reporting.

import { NextResponse } from "next/server";
import { deleteCampaign } from "@/app/[locale]/(dashboard)/campaigns/actions";

export const maxDuration = 30;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await deleteCampaign(id);
    if (result.error) return NextResponse.json({ error: result.error });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unexpected server error",
    });
  }
}
