// Server-side Supabase client — use in Server Components, Server Actions, Route Handlers
// Reads cookies from the incoming request to maintain the user session
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  // cookies() is async in Next.js 16
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Can be ignored in Server Components — middleware handles session refresh
          }
        },
      },
    }
  );
}
