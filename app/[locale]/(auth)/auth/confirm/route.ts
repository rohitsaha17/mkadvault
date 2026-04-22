// Auth confirm — the 2024+ default path Supabase's email templates
// point at. Prior templates pointed at /auth/callback via Supabase's
// own /auth/v1/verify endpoint; newer templates skip that hop and go
// straight to SITE_URL/auth/confirm?token_hash=…&type=invite&next=…
//
// Same verification logic as /auth/callback — just a different URL so
// the email link always lands on a route we handle.
import type { NextRequest } from "next/server";
import { handleVerifyLink } from "@/lib/auth/handle-verify-link";

export async function GET(request: NextRequest) {
  return handleVerifyLink(request);
}
