// proxy.ts — runs on every request (Next.js 16 replacement for middleware.ts)
// Responsibilities:
//   1. Refresh the Supabase session (keeps auth cookies fresh)
//   2. Redirect unauthenticated users away from protected routes
//   3. Redirect authenticated users away from auth pages
//   4. Handle next-intl locale routing
import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { createMiddlewareClient } from "./lib/supabase/middleware";

// next-intl middleware handles locale detection and URL rewriting
const intlMiddleware = createIntlMiddleware(routing);

// Routes that require authentication (pathname must start with one of these)
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/sites",
  "/landowners",
  "/agencies",
  "/contracts",
  "/clients",
  "/campaigns",
  "/billing",
  "/proposals",
  "/reports",
  "/settings",
];

// Auth pages (redirect away if already logged in)
const AUTH_PATHS = ["/login", "/register", "/forgot-password"];

// Onboarding page — requires auth but no org
const ONBOARDING_PATH = "/onboarding";

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip locale prefix to get the real path for matching
  // e.g. "/hi/dashboard" → "/dashboard", "/login" → "/login"
  const locales = routing.locales as readonly string[];
  const firstSegment = pathname.split("/")[1];
  const isLocaleSegment = locales.includes(firstSegment);
  const realPath = isLocaleSegment ? pathname.slice(firstSegment.length + 1) || "/" : pathname;

  const isProtected   = PROTECTED_PREFIXES.some((p) => realPath === p || realPath.startsWith(`${p}/`));
  const isAuthPage    = AUTH_PATHS.some((p) => realPath === p || realPath.startsWith(`${p}/`));
  const isOnboarding  = realPath === ONBOARDING_PATH || realPath.startsWith(`${ONBOARDING_PATH}/`);

  // ─── 1. Refresh Supabase session ────────────────────────────────────────────
  // This MUST run on every request so the auth token stays current.
  const { supabase, supabaseResponse } = await createMiddlewareClient(request);
  // getUser() validates the token with Supabase and refreshes it if needed
  const { data: { user } } = await supabase.auth.getUser();

  // ─── 2. Auth-based redirects ─────────────────────────────────────────────────
  if (isProtected && !user) {
    // Not logged in → send to login, preserving the locale prefix if any
    const loginPath = isLocaleSegment ? `/${firstSegment}/login` : "/login";
    const url = request.nextUrl.clone();
    url.pathname = loginPath;
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user && !isOnboarding) {
    // Already logged in → send to dashboard (unless on onboarding page)
    const dashboardPath = isLocaleSegment ? `/${firstSegment}/dashboard` : "/dashboard";
    const url = request.nextUrl.clone();
    url.pathname = dashboardPath;
    return NextResponse.redirect(url);
  }

  // ─── 2a. Profile check: org, active status, role ────────────────────────────
  // Fetch profile once for all checks: onboarding redirect, deactivation, roles.
  if (user && (isProtected || isOnboarding)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    const hasOrg = !!profile?.org_id;

    // No org + accessing protected route → send to onboarding
    if (!hasOrg && isProtected) {
      const onboardPath = isLocaleSegment ? `/${firstSegment}/onboarding` : "/onboarding";
      const url = request.nextUrl.clone();
      url.pathname = onboardPath;
      return NextResponse.redirect(url);
    }

    // Has org + on onboarding → send to dashboard
    if (hasOrg && isOnboarding) {
      const dashboardPath = isLocaleSegment ? `/${firstSegment}/dashboard` : "/dashboard";
      const url = request.nextUrl.clone();
      url.pathname = dashboardPath;
      return NextResponse.redirect(url);
    }

    // Remaining checks only apply to protected routes (not onboarding)
    // If the account has been deactivated by an admin, force logout flow
    if (isProtected && (!profile || profile.is_active === false)) {
      const loginPath = isLocaleSegment ? `/${firstSegment}/login` : "/login";
      const url = request.nextUrl.clone();
      url.pathname = loginPath;
      url.searchParams.set("error", "Account deactivated");
      return NextResponse.redirect(url);
    }

    // Role-based route protection (only for protected routes with active profiles)
    if (isProtected && profile) {
      const ROLE_RULES: Record<string, string[]> = {
        "/settings/users": ["super_admin", "admin"],
        "/billing":        ["super_admin", "admin", "accounts"],
        "/reports":        ["super_admin", "admin", "sales_manager"],
      };

      for (const [routePrefix, allowedRoles] of Object.entries(ROLE_RULES)) {
        const matchesRoute =
          realPath === routePrefix || realPath.startsWith(`${routePrefix}/`);
        if (matchesRoute && !allowedRoles.includes(profile.role)) {
          const dashboardPath = isLocaleSegment
            ? `/${firstSegment}/dashboard`
            : "/dashboard";
          const url = request.nextUrl.clone();
          url.pathname = dashboardPath;
          return NextResponse.redirect(url);
        }
      }
    }
  }

  // ─── 3. Run next-intl locale routing ────────────────────────────────────────
  const intlResponse = intlMiddleware(request);

  // Copy the Supabase session cookies onto the intl response so the browser
  // stores the refreshed tokens. Without this, auth state would be lost.
  supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
    intlResponse.cookies.set(name, value);
  });

  return intlResponse;
}

export const config = {
  // Run on page requests only. We explicitly exclude:
  //   - All of /_next/* (Next.js build assets, HMR, data routes)
  //   - favicon.ico
  //   - Static files (images, fonts, js, css, maps, manifests)
  // Without this, the proxy fires once per JS chunk / font / image on every
  // navigation and each call does a Supabase round-trip — ~10-50 extra calls
  // per page for no benefit.
  matcher: [
    "/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf|eot|txt|xml|json|mp4|webm|wav|mp3)$).*)",
  ],
};
