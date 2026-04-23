// Route Handler for cancelling a campaign. See /api/campaigns/route.ts
// for why we use Route Handlers instead of the Server Action directly.

import { NextResponse } from "next/server";
import { cancelCampaign } from "@/app/[locale]/(dashboard)/campaigns/actions";

export const maxDuration = 30;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await cancelCampaign(id);
    if (result.error) return NextResponse.json({ error: result.error });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unexpected server error",
    });
  }
}
