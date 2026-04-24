// Settings page — organization details, user profile, and alert preferences
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Users, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { AlertPreferences } from "@/components/settings/AlertPreferences";
import { OrgSettingsForm } from "@/components/settings/OrgSettingsForm";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { AlertPreference, Organization, OrganizationBankAccount, Profile } from "@/lib/types/database";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("settings");

  // Session (user + profile) is cached per-request — reused from layout
  const session = await getSession();
  if (!session) return <p className="p-6 text-sm text-muted-foreground">Not authenticated.</p>;
  if (!session.profile) return <p className="p-6 text-sm text-muted-foreground">Profile not found.</p>;

  const { user, profile } = session;
  const supabase = await createClient();

  // The settings page needs the full profile (phone isn't on the cached one)
  const { data: fullProfile } = await supabase
    .from("profiles")
    .select("id, org_id, full_name, phone, role, avatar_url")
    .eq("id", user.id)
    .single();
  if (!fullProfile) return <p className="p-6 text-sm text-muted-foreground">Profile not found.</p>;

  // Load org + alert preferences + bank accounts in parallel.
  //
  // `proposal_terms_template` is fetched separately because migration 026
  // is not applied on every environment yet (some DBs don't have the
  // column). Including it in the main select made the whole org query
  // fail with 42703, which nulled `org` and hid this entire section.
  // Split so the core settings always load regardless.
  const [orgResult, orgTemplateResult, prefsResult, bankResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, address, city, state, pin_code, gstin, pan, phone, email, logo_url")
      .eq("id", profile.org_id!)
      .single(),
    supabase
      .from("organizations")
      .select("proposal_terms_template")
      .eq("id", profile.org_id!)
      .single(),
    supabase
      .from("alert_preferences")
      .select("*")
      .eq("organization_id", profile.org_id!)
      .eq("user_id", user.id),
    supabase
      .from("organization_bank_accounts")
      .select("*")
      .eq("organization_id", profile.org_id!)
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  const orgCore = orgResult.data as unknown as Omit<Organization, "proposal_terms_template"> | null;
  const templateValue =
    (orgTemplateResult.data as { proposal_terms_template?: string | null } | null)
      ?.proposal_terms_template ?? null;
  const org = orgCore
    ? ({ ...orgCore, proposal_terms_template: templateValue } as Organization)
    : null;

  const alertPrefs = (prefsResult.data ?? []) as unknown as AlertPreference[];
  const bankAccounts = (bankResult.data ?? []) as unknown as OrganizationBankAccount[];

  // Sign the org logo (private bucket) so the settings form can render
  // a thumbnail. 1-hour TTL matches how long a typical settings session
  // sits open; refreshes on next page load.
  let orgLogoSignedUrl: string | null = null;
  if (org?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("org-logos")
      .createSignedUrl(org.logo_url, 60 * 60);
    orgLogoSignedUrl = signed?.signedUrl ?? null;
  }

  // Admin check must look at the full `roles` array (migration 020
  // introduced multi-role users — e.g. an executive+accounts combo).
  // The old `profile.role` check hid the Organisation card for any
  // admin whose primary role column was set to something else.
  const rolesArr: string[] =
    Array.isArray(profile.roles) && profile.roles.length > 0
      ? profile.roles
      : profile.role
      ? [profile.role]
      : [];
  const isAdmin = rolesArr.some((r) =>
    ["super_admin", "admin"].includes(r),
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Workspace"
        title={t("title")}
        description={t("subtitle")}
      />

      <div className="space-y-8">
        {/* ── User Profile ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card card-elevated p-6">
          <div className="mb-5 border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground">{t("yourProfile")}</h2>
          </div>
          <ProfileForm profile={fullProfile as unknown as Profile} email={user.email ?? ""} />
        </section>

        {/* ── Organization ─────────────────────────────────────────────── */}
        {/* Show to every team member — the company's letterhead
            details (address, GSTIN, phone, logo) aren't sensitive and
            everyone needs to verify how their org appears on PDFs.
            Editing is still gated on admin via `canEdit`. */}
        {org && (
          <section className="rounded-2xl border border-border bg-card card-elevated p-6">
            <div className="mb-5 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-foreground">{t("organisation")}</h2>
              {!isAdmin && (
                <span className="text-xs text-muted-foreground">
                  Read-only — ask an admin to edit
                </span>
              )}
            </div>
            <OrgSettingsForm
              org={org}
              orgLogoSignedUrl={orgLogoSignedUrl}
              bankAccounts={bankAccounts}
              canEdit={isAdmin}
            />
          </section>
        )}

        {/* ── Team Members (admin only) ────────────────────────────────── */}
        {isAdmin && (
          <Link
            href="/settings/users"
            className="group flex items-center gap-4 rounded-2xl border border-border bg-card card-elevated p-6 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 ring-1 ring-inset ring-border">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-foreground">Team Members</h2>
              <p className="text-sm text-muted-foreground">
                Invite new users, manage roles and access for your organization.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}

        {/* ── Alert Preferences ────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card card-elevated p-6">
          <div className="mb-5 border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground">{t("alertPreferences")}</h2>
          </div>
          <AlertPreferences preferences={alertPrefs} canEdit={isAdmin} />
        </section>

      </div>
    </div>
  );
}
