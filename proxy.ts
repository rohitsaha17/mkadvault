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
import { createAdminClient } from "./lib/supabase/admin";

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

// Auth pages (redirect away if already logged in).
// NOTE: /forgot-password is intentionally NOT in this list — a logged-in
// user clicking "Change Password" in UserMenu needs to reach the page so
// they can request a reset email for their own account.
const AUTH_PATHS = ["/login", "/register"];

// Onboarding page — requires auth but no org
const ONBOARDING_PATH = "/onboarding";

// Accept-invite page — requires auth. Unlike onboarding we still want it
// reachable even when the user already has an org_id (invitees are stamped
// with org_id at invite time, but still need to set a password).
const ACCEPT_INVITE_PATH = "/accept-invite";

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Detect Server Action POSTs. Next.js sets the `next-action` header on
  // every server-action invocation (both form submissions and `useActionState`
  // calls). These requests stream an RSC payload as a response — if the intl
  // middleware issues a rewrite or redirect for such a POST, the client-side
  // action response parser fails with
  //   "An unexpected response was received from the server."
  // To avoid that, we keep the session-refresh work but SKIP intl middleware
  // for server-action traffic.
  const isServerAction =
    request.method === "POST" && request.headers.has("next-action");

  // Strip locale prefix to get the real path for matching
  // e.g. "/hi/dashboard" → "/dashboard", "/login" → "/login"
  const locales = routing.locales as readonly string[];
  const firstSegment = pathname.split("/")[1];
  const isLocaleSegment = locales.includes(firstSegment);
  const realPath = isLocaleSegment ? pathname.slice(firstSegment.length + 1) || "/" : pathname;

  const isProtected    = PROTECTED_PREFIXES.some((p) => realPath === p || realPath.startsWith(`${p}/`));
  const isAuthPage     = AUTH_PATHS.some((p) => realPath === p || realPath.startsWith(`${p}/`));
  const isOnboarding   = realPath === ONBOARDING_PATH || realPath.startsWith(`${ONBOARDING_PATH}/`);
  const isAcceptInvite = realPath === ACCEPT_INVITE_PATH || realPath.startsWith(`${ACCEPT_INVITE_PATH}/`);

  // ─── 1. Refresh Supabase session ────────────────────────────────────────────
  // This MUST run on every request so the auth token stays current.
  const { supabase, supabaseResponse } = await createMiddlewareClient(request);
  // getUser() validates the token with Supabase and refreshes it if needed
  const { data: { user } } = await supabase.auth.getUser();

  // Helper: build a redirect response that carries Supabase's refreshed
  // session cookies. Without copying cookies, a redirect during proxy can
  // drop the newly-rotated access/refresh tokens, logging the user out.
  const redirectTo = (path: string, searchParams?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    if (searchParams) {
      for (const [k, v] of Object.entries(searchParams)) {
        url.searchParams.set(k, v);
      }
    }
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(({ name, value }) => {
      res.cookies.set(name, value);
    });
    return res;
  };

  // ─── 2. Auth-based redirects ─────────────────────────────────────────────────
  if ((isProtected || isAcceptInvite) && !user) {
    // Not logged in → send to login, preserving the locale prefix if any
    const loginPath = isLocaleSegment ? `/${firstSegment}/login` : "/login";
    return redirectTo(loginPath);
  }

  if (isAuthPage && user && !isOnboarding) {
    // Already logged in → send to dashboard (unless on onboarding page)
    const dashboardPath = isLocaleSegment ? `/${firstSegment}/dashboard` : "/dashboard";
    return redirectTo(dashboardPath);
  }

  // Invitees who still need to set a password must stay on /accept-invite
  // until they complete it. Block access to other protected routes.
  if (user && isProtected) {
    const needsPasswordSetup =
      user.user_metadata?.needs_password_setup === true;
    if (needsPasswordSetup) {
      const acceptPath = isLocaleSegment
        ? `/${firstSegment}/accept-invite`
        : "/accept-invite";
      return redirectTo(acceptPath);
    }
  }

  // ─── 2a. Profile check: org, active status, role ────────────────────────────
  // Fetch profile once for all checks: onboarding redirect, deactivation, roles.
  //
  // IMPORTANT: we use the admin (service-role) client here. Routing decisions
  // must not be at the mercy of RLS quirks — if a policy regression or a
  // missing migration hides the user's own row from the authenticated client,
  // the proxy would leave a logged-in user stuck on /onboarding even when
  // their profile already has an org_id (the exact bug we were debugging).
  // The admin client bypasses RLS, so the routing decision is always based
  // on the true profile state. This is safe: we only read, and we key on
  // `user.id` which is already verified by `auth.getUser()` above.
  if (user && (isProtected || isOnboarding)) {
    // Try the admin client first (bypasses RLS). If the env var is missing
    // in this deployment or the request fails for any reason, fall back to
    // the authenticated client so the site still works. We log but never
    // throw — a proxy crash here would brick the whole app.
    type ProxyProfile = {
      org_id: string | null;
      role: string;
      roles: string[] | null;
      is_active: boolean | null;
    };
    let profile: ProxyProfile | null = null;

    // Helper that queries profiles and, if the `roles` column is missing
    // (migration 020 not applied to this DB yet), retries without it so the
    // proxy doesn't crash the entire request pipeline.
    const fetchProfile = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: any
    ): Promise<ProxyProfile | null> => {
      const res = await client
        .from("profiles")
        .select("org_id, role, roles, is_active")
        .eq("id", user.id)
        .maybeSingle();
      if (res.error && /roles/i.test(res.error.message)) {
        const fb = await client
          .from("profiles")
          .select("org_id, role, is_active")
          .eq("id", user.id)
          .maybeSingle();
        return (fb.data as ProxyProfile | null) ?? null;
      }
      return (res.data as ProxyProfile | null) ?? null;
    };

    const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (hasServiceRoleKey) {
      try {
        const admin = createAdminClient();
        profile = await fetchProfile(admin);
      } catch (err) {
        console.error("[proxy] admin profile lookup failed, falling back:", err);
      }
    }

    if (!profile) {
      try {
        profile = await fetchProfile(supabase);
      } catch (err) {
        console.error("[proxy] authenticated profile lookup failed:", err);
      }
    }

    // Null profile = the handle_new_user trigger hasn't fired yet (can happen
    // right after signup/invite). Send them to onboarding rather than looping
    // them to /login?error=Account+deactivated.
    if (!profile && !isOnboarding) {
      const onboardPath = isLocaleSegment ? `/${firstSegment}/onboarding` : "/onboarding";
      return redirectTo(onboardPath);
    }

    const hasOrg = !!profile?.org_id;

    // No org + accessing protected route → send to onboarding
    if (!hasOrg && isProtected) {
      const onboardPath = isLocaleSegment ? `/${firstSegment}/onboarding` : "/onboarding";
      return redirectTo(onboardPath);
    }

    // Has org + on onboarding → send to dashboard
    if (hasOrg && isOnboarding) {
      const dashboardPath = isLocaleSegment ? `/${firstSegment}/dashboard` : "/dashboard";
      return redirectTo(dashboardPath);
    }

    // Remaining checks only apply to protected routes (not onboarding)
    // If the account has been explicitly deactivated, force logout flow.
    // (profile is guaranteed non-null here — the null case returned above.)
    if (isProtected && profile && profile.is_active === false) {
      const loginPath = isLocaleSegment ? `/${firstSegment}/login` : "/login";
      return redirectTo(loginPath, { error: "Account deactivated" });
    }

    // Role-based route protection (only for protected routes with active profiles)
    if (isProtected && profile) {
      const ROLE_RULES: Record<string, string[]> = {
        // Team-member management — admins only. Managers explicitly cannot
        // invite/edit users or change settings (they do sales + ops + accounts).
        "/settings/users": ["super_admin", "admin"],
        // Billing accessible to anyone who handles money: accountants +
        // managers (who cover accounts too) + admins.
        "/billing":        ["super_admin", "admin", "manager", "accounts"],
        // Reports: same audience as the full dashboard — managers + execs + admins.
        "/reports":        ["super_admin", "admin", "manager", "executive"],
      };

      // Check the roles[] array if present (multi-role users), otherwise
      // fall back to the primary role column.
      const userRoles: string[] =
        Array.isArray((profile as { roles?: string[] }).roles) &&
        ((profile as { roles?: string[] }).roles?.length ?? 0) > 0
          ? ((profile as { roles?: string[] }).roles as string[])
          : [profile.role];

      for (const [routePrefix, allowedRoles] of Object.entries(ROLE_RULES)) {
        const matchesRoute =
          realPath === routePrefix || realPath.startsWith(`${routePrefix}/`);
        if (matchesRoute && !userRoles.some((r) => allowedRoles.includes(r))) {
          const dashboardPath = isLocaleSegment
            ? `/${firstSegment}/dashboard`
            : "/dashboard";
          return redirectTo(dashboardPath);
        }
      }
    }
  }

  // ─── 3. Run next-intl locale routing ────────────────────────────────────────
  // For Server Action POSTs we must NOT let intl middleware rewrite the URL —
  // that breaks the RSC action response stream on the client. Just return the
  // session-refresh response so cookies are still rotated.
  if (isServerAction) {
    return supabaseResponse;
  }

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
