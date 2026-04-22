// Team members page — list all users in the current organization,
// invite new ones, change roles, and deactivate accounts.
// Admin-only (super_admin / admin). Other roles get a friendly notice.

import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shared/PageHeader";
import { UsersManagement } from "@/components/settings/UsersManagement";
import type { UserRole } from "@/lib/types/database";

export const metadata = { title: "Team Members" };

export interface TeamMember {
  id: string;
  full_name: string | null;
  email: string | null;
  // Primary role — kept for backward compat. Prefer `roles` for gating.
  role: UserRole;
  // Full role set (single-role users have [role]; exec+accountant users
  // have both). Always present — page.tsx normalises when the DB row is
  // missing the column (pre-migration-020 instances).
  roles: UserRole[];
  is_active: boolean;
  phone: string | null;
  last_sign_in_at: string | null;
  created_at: string;
}

export default async function UsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const session = await getSession();

  if (!session) {
    return (
      <p className="p-6 text-sm text-muted-foreground">Not authenticated.</p>
    );
  }

  const { user, profile } = session;

  if (!profile?.org_id) {
    return (
      <div className="max-w-3xl">
        <PageHeader eyebrow="Workspace" title="Team Members" />
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Your account is not linked to an organisation yet.
        </div>
      </div>
    );
  }

  // Admin check looks at the full roles[] set so executive+accountant combo
  // users don't accidentally get elevated — only true admins pass.
  const profileRoles: string[] =
    Array.isArray(profile.roles) && profile.roles.length > 0
      ? profile.roles
      : [profile.role ?? ""];
  const isAdmin = profileRoles.some((r) => ["super_admin", "admin"].includes(r));

  if (!isAdmin) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          eyebrow="Workspace"
          title="Team Members"
          description="Only administrators can manage team members."
        />
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Ask your organization admin to invite new users or change roles.
        </div>
      </div>
    );
  }

  // Fetch all profiles in this org. This is the canonical member list —
  // even if the admin auth lookup below fails we can still render something
  // useful (names + roles) rather than crashing the whole page.
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, full_name, role, roles, is_active, phone, created_at")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: true });

  const profilesList = profilesData ?? [];

  // Fetch auth emails and last sign-in via admin client (service role).
  // This call is the historical source of "An unexpected response was
  // received from the server" errors — GoTrue sometimes throws 5xx, and if
  // SUPABASE_SERVICE_ROLE_KEY isn't set the admin client fails mid-request.
  // Wrap defensively: on failure we still render the page with profile
  // rows only (email/last-sign-in columns will just show "—").
  const authMap = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
  let authFetchError: string | null = null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    authFetchError =
      "SUPABASE_SERVICE_ROLE_KEY is not set on the server — email and last-sign-in details can't be shown.";
  } else {
    try {
      const admin = createAdminClient();
      const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (authErr) {
        authFetchError = `Couldn't load auth details: ${authErr.message}`;
      } else {
        for (const u of authData?.users ?? []) {
          authMap.set(u.id, {
            email: u.email ?? null,
            last_sign_in_at: u.last_sign_in_at ?? null,
          });
        }
      }
    } catch (err) {
      // Swallow any throw from the admin SDK so this page never blows up.
      console.error("[settings/users] listUsers failed:", err);
      authFetchError =
        err instanceof Error
          ? `Couldn't load auth details: ${err.message}`
          : "Couldn't load auth details.";
    }
  }

  const members: TeamMember[] = profilesList.map((p) => {
    const auth = authMap.get(p.id);
    // Fall back to [role] if `roles` column is missing/empty on this instance.
    const rolesArr: UserRole[] =
      Array.isArray((p as { roles?: string[] }).roles) &&
      ((p as { roles?: string[] }).roles?.length ?? 0) > 0
        ? ((p as { roles?: string[] }).roles as UserRole[])
        : [p.role as UserRole];
    return {
      id: p.id,
      full_name: p.full_name,
      email: auth?.email ?? null,
      role: p.role as UserRole,
      roles: rolesArr,
      is_active: p.is_active,
      phone: p.phone,
      last_sign_in_at: auth?.last_sign_in_at ?? null,
      created_at: p.created_at,
    };
  });

  return (
    <div className="max-w-5xl">
      <Link
        href="/settings"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Settings
      </Link>

      <PageHeader
        eyebrow="Workspace"
        title="Team Members"
        description="Invite new users, change their role, and manage access to your organization."
      />

      {authFetchError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          {authFetchError}
        </div>
      )}

      <UsersManagement members={members} currentUserId={user.id} />
    </div>
  );
}
