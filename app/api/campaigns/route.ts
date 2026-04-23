// Route Handler for creating + draft-saving campaigns.
//
// Why a Route Handler (and not just the Server Action we already have):
// Server Actions get a content-hashed URL per build. When a user's
// browser has a cached client bundle from deploy N and the server has
// deploy N+1, the action hash no longer matches and Next.js returns
// HTML — the client then surfaces the cryptic
//   "An unexpected response was received from the server."
// We kept hitting that on Create / Save Draft. Route Handlers have
// stable URLs (/api/campaigns) so they survive deploys without the
// user needing to hard-refresh the tab.
//
// Contract:
//   POST /api/campaigns              { ...createCampaignValues }
//   POST /api/campaigns?mode=draft   { ...draftValues }
//   → 200 { id } on success
//   → 200 { error } on validation / DB failure (status 200 keeps the
//     client's parse path uniform)

import { NextResponse, type NextRequest } from "next/server";
import { createCampaign, saveCampaignDraft } from "@/app/[locale]/(dashboard)/campaigns/actions";

export const maxDuration = 30;

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(request: NextRequest) {
  const mode = new URL(request.url).searchParams.get("mode");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" });
  }

  try {
    const result =
      mode === "draft"
        ? await saveCampaignDraft(body)
        : await createCampaign(body);

    if ("error" in result) return json({ error: result.error });
    return json({ id: result.id });
  } catch (err) {
    // createCampaign / saveCampaignDraft are already wrapped in try/catch
    // internally; this outer catch is just belt-and-braces so a runtime
    // error can never surface as HTML.
    return json({
      error: err instanceof Error ? err.message : "Unexpected server error",
    });
  }
}
