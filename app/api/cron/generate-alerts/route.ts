// Vercel Cron API route — runs daily at 6 AM IST (00:30 UTC)
// Secured with CRON_SECRET environment variable so random people can't trigger it.
// Vercel automatically sets the "Authorization: Bearer <secret>" header when
// invoking cron jobs — we just need to verify it matches our secret.
//
// vercel.json cron config:
//   { "crons": [{ "path": "/api/cron/generate-alerts", "schedule": "30 0 * * *" }] }

import { NextRequest, NextResponse } from "next/server";
import { generateAlertsForAllOrgs } from "@/lib/alerts/generate";

export const runtime = "nodejs"; // needs crypto + full Node.js env
export const maxDuration = 60;  // Vercel function timeout (seconds)

export async function GET(req: NextRequest) {
  // Verify the cron secret. Required in every non-localhost environment
  // — see the same gate in /api/cron/auto-complete-campaigns for the
  // rationale (Vercel previews fall through with NODE_ENV=production
  // but no secret, generating retry noise).
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;
  const host = req.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.");

  if (!expectedToken) {
    if (!isLocalhost) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    console.warn("[cron] generate-alerts running without CRON_SECRET (localhost only)");
  } else if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  console.log("[cron] generate-alerts started at", new Date().toISOString());

  try {
    const result = await generateAlertsForAllOrgs();
    const elapsed = Date.now() - start;

    console.log(`[cron] generate-alerts finished in ${elapsed}ms — ${result.processed} orgs processed`);
    if (result.errors.length) {
      console.error("[cron] errors:", result.errors);
    }

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      errors: result.errors,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] generate-alerts fatal error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
