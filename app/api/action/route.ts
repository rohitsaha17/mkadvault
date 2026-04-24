// POST /api/action
//
// Stable-URL dispatcher for every user-facing Server Action in the
// app. Clients fetch this endpoint with a JSON body of the shape
//   { name: "createExpense", args: [firstArg, secondArg, ...] }
// and it invokes the whitelisted function from ACTION_REGISTRY on
// the server, returning its result as JSON.
//
// WHY THIS EXISTS
// ───────────────
// Next.js 16 assigns every Server Action a content-hashed URL that
// changes on every build. After a deploy, browser tabs that still
// have the old client JS cached POST to hashes the new server
// doesn't recognise — the server returns HTML 404/500, and the
// router reducer surfaces the cryptic
//   "An unexpected response was received from the server."
// This affected every create/update/delete form in the app. Instead
// of adding a dedicated Route Handler for each of 30+ actions, one
// dispatcher covers the entire surface with a permanent URL.
//
// The dispatcher imports ACTION_REGISTRY server-side only. Clients
// can only invoke names present in that explicit whitelist — no
// dynamic invocation, no risk of reaching internal helpers.

import { NextResponse, type NextRequest } from "next/server";
import { ACTION_REGISTRY } from "@/lib/actions/registry";

export const maxDuration = 30;

function errJson(message: string, status = 200) {
  // status 200 by default so the client's `.json()` path is uniform
  // (toasts on `{error}` rather than treating it as a transport failure).
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errJson("Invalid JSON body");
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { name?: unknown }).name !== "string"
  ) {
    return errJson("Missing 'name' field");
  }

  const { name, args } = body as { name: string; args?: unknown };
  const fn = ACTION_REGISTRY[name as keyof typeof ACTION_REGISTRY];
  if (!fn) return errJson(`Unknown action: ${name}`);

  // args is always an array of positional arguments. undefined/null is
  // allowed (zero-arg actions). Anything else is a client bug.
  const argsArray: unknown[] = Array.isArray(args) ? args : [];

  try {
    const result = await fn(...argsArray);
    // All our actions return either { error } or { … success data … }.
    // The dispatcher forwards whatever shape the action chose. Callers
    // check for `.error` like they would with a direct action call.
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    // Server Actions already have their own try/catch wrappers, but
    // belt-and-braces here so a runtime crash can never surface as
    // HTML to the client.
    return errJson(err instanceof Error ? err.message : "Unexpected server error");
  }
}
