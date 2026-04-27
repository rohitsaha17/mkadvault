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
  // Verify the cron secret. We require CRON_SECRET in EVERY environment
  // (dev, preview, prod) to avoid the trap where a Vercel preview
  // deployment runs with NODE_ENV=production but no secret configured
  // → silent 500 retries that look like cron noise. The only carve-out
  // is local development against `localhost`, where we don't run a
  // scheduler and exposing the route via curl is harmless.
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;
  const host = req.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.");

  if (!expectedToken) {
    if (!isLocalhost) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 },
      );
    }
    // localhost dev with no secret — allow through with a warning so
    // the dev knows they should set one before deploying.
    console.warn(
      "[cron] auto-complete-campaigns running without CRON_SECRET (localhost only)",
    );
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
