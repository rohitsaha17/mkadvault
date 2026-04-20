// Supabase client for use inside proxy.ts (Next.js 16 middleware)
// This client reads/writes cookies from the request and response objects directly.
// It must NOT use next/headers — that is only available in Server Components.
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Creates a Supabase client inside proxy.ts, refreshes the session,
 * and returns both the client and the (possibly updated) response.
 *
 * IMPORTANT: Always return the `supabaseResponse` from your proxy function
 * (or copy its cookies onto your own response) so session tokens stay fresh.
 */
export async function createMiddlewareClient(request: NextRequest) {
  // Start with a "pass through" response
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Read cookies from the incoming request
        getAll() {
          return request.cookies.getAll();
        },
        // Write cookies to BOTH the request (so they're available later in
        // this request cycle) AND the response (so the browser stores them)
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Re-create response so it picks up the mutated request cookies
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  return { supabase, supabaseResponse };
}
