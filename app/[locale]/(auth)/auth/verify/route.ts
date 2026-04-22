// Auth verify — additional alias for email links. Some custom
// templates point at /auth/verify. All three paths (/auth/callback,
// /auth/confirm, /auth/verify) go through the same handler so the
// invite flow works no matter which shape the email link takes.
import type { NextRequest } from "next/server";
import { handleVerifyLink } from "@/lib/auth/handle-verify-link";

export async function GET(request: NextRequest) {
  return handleVerifyLink(request);
}
