// Vercel Cron API route — auto-completes campaigns whose end_date has passed.
// Runs daily at 1 AM IST (19:30 UTC previous day).
// Secured with CRON_SECRET to prevent unauthorized access.
//
// vercel.json cron config:
//   { "path": "/api/cron/auto-complete-campaigns", "schedule": "30 19 * * *" }

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoCompletePastDueCampaigns } from "@/lib/campaigns/auto-complete";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Verify the cron secret
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 }
      );
    }
  } else if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  console.log(
    "[cron] auto-complete-campaigns started at",
    new Date().toISOString()
  );

  try {
    // Use admin client to bypass RLS and process all organizations
    const adminClient = createAdminClient();
    const result = await autoCompletePastDueCampaigns(adminClient);
    const elapsed = Date.now() - start;

    console.log(
      `[cron] auto-complete-campaigns finished in ${elapsed}ms — ` +
        `${result.completed} completed, ${result.sitesFreed} sites freed`
    );
    if (result.errors.length) {
      console.error("[cron] errors:", result.errors);
    }

    return NextResponse.json({
      ok: true,
      ...result,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] auto-complete-campaigns fatal error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
