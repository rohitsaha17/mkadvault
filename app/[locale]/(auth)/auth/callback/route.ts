// Auth callback — entry point Supabase redirects users to after an
// invite / magic-link / password-reset / email-confirm link is clicked
// with `redirectTo: ${origin}/auth/callback`.
//
// All the real work lives in lib/auth/handle-verify-link.ts so that
// /auth/confirm and /auth/verify (both used by different Supabase
// email template versions) can share the same logic. See the helper
// file for the three link shapes we accept.
import type { NextRequest } from "next/server";
import { handleVerifyLink } from "@/lib/auth/handle-verify-link";

export async function GET(request: NextRequest) {
  return handleVerifyLink(request);
}
