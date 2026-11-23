// localizedRedirect — server-only helper that redirects while preserving
// the user's current locale. `redirect("/dashboard")` from next/navigation
// drops the /hi segment, sending Hindi users back to the English
// dashboard. This wrapper reads the locale that next-intl resolved for
// the current request and forwards it to the locale-aware redirect from
// i18n/navigation, so /dashboard becomes /hi/dashboard for a Hindi user
// and plain /dashboard for English (localePrefix: "as-needed").
//
// Use this from server actions and server components whenever you need
// to jump to another app route after an action finishes. Keep the raw
// `redirect` from next/navigation for things that don't need locale
// (external URLs, same-path reloads, etc.).
//
// Callers should use the companion `assertRedirected()` after the
// await so TypeScript's control-flow analysis knows the function
// doesn't fall through:
//
//   await localizedRedirect("/dashboard");
//   assertRedirected(); // never — TS now treats this line onward as dead
import "server-only";
import { getLocale } from "next-intl/server";
import { redirect as intlRedirect } from "@/i18n/navigation";

export async function localizedRedirect(href: string): Promise<never> {
  const locale = await getLocale();
  intlRedirect({ href, locale });
  // Unreachable: intlRedirect throws. Satisfies TS's `never` return.
  throw new Error("unreachable");
}

// Call right after `await localizedRedirect(...)` so TS sees a terminal
// never-returning statement and stops asking for a trailing return.
// Runtime: never actually reached because localizedRedirect throws.
export function assertRedirected(): never {
  throw new Error("unreachable: redirect should have fired");
}
