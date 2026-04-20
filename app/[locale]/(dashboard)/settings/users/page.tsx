// Team members page — list all users in the current organization,
// invite new ones, change roles, and deactivate accounts.
// Admin-only (super_admin / admin). Other roles get a friendly notice.

import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shared/PageHeader";
import { UsersManagement } from "@/components/settings/UsersManagement";
import type { UserRole } from "@/lib/types/database";

export const metadata = { title: "Team Members" };

export interface TeamMember {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <p className="p-6 text-sm text-muted-foreground">Not authenticated.</p>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

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

  const isAdmin = ["super_admin", "admin"].includes(profile.role);

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

  // Fetch all profiles in this org
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, phone, created_at")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: true });

  const profilesList = profilesData ?? [];

  // Fetch auth emails and last sign-in via admin client (service role)
  const admin = createAdminClient();
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 200 });
  const authMap = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
  for (const u of authData?.users ?? []) {
    authMap.set(u.id, {
      email: u.email ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    });
  }

  const members: TeamMember[] = profilesList.map((p) => {
    const auth = authMap.get(p.id);
    return {
      id: p.id,
      full_name: p.full_name,
      email: auth?.email ?? null,
      role: p.role as UserRole,
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

      <UsersManagement members={members} currentUserId={user.id} />
    </div>
  );
}
