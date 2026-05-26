// Central notification dispatcher. Every trigger in the app calls
// `notify(input)` — it figures out who in the org should be told,
// writes in-app alert rows for them, and sends branded Resend emails
// to the subset whose preferences want one. Fire-and-forget from the
// caller's point of view; failures are logged, never thrown.
//
// Design notes:
//   • We use the admin Supabase client so a trigger fired from any
//     RLS context can still write alerts for other users in the org.
//     The dispatcher is only called from trusted server-side code
//     (server actions / route handlers / cron) so admin access is OK.
//   • alerts has a dedup unique index on
//     (org, alert_type, related_entity_id, scheduled_date). We rely
//     on `onConflict: ... do nothing` semantics: if the same event
//     fires twice on the same day for the same entity, the second
//     write is silently skipped. Good for cron retries.
//   • Email send uses Resend's REST API directly (no SDK) so we
//     stay consistent with lib/email/alert-emails.ts. Same env var.

import { createAdminClient } from "@/lib/supabase/admin";
import { AUDIENCE, type AudienceRole } from "./audience";
import { renderBrandedEmail, type BrandInfo } from "./email-template";
import type { NotificationInput, Severity } from "./types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const FROM_EMAIL =
  process.env.NOTIFICATIONS_FROM_EMAIL ??
  // Sane default for the Resend onboarding sandbox. Override in
  // production once a sending domain is verified in Resend.
  "MK ADD <onboarding@resend.dev>";

// Roles whose visibility never narrows on "ownerOnlyForExec" events.
// We only narrow the executive role.
const NEVER_NARROW: AudienceRole[] = [
  "super_admin",
  "admin",
  "manager",
  "accounts",
];

interface ProfileRow {
  id: string;
  role: string | null;
  roles: string[] | null;
  full_name: string | null;
  notification_scope: "org" | "own" | null;
  email: string | null;
}

/**
 * Fan an event out to every eligible recipient in the org.
 * Writes in-app alert rows and (for the email-eligible subset)
 * sends a branded Resend email per recipient.
 *
 * Returns a summary the caller can log; never throws.
 */
export async function notify(input: NotificationInput): Promise<{
  inAppInserted: number;
  emailsSent: number;
  emailsFailed: number;
}> {
  const summary = { inAppInserted: 0, emailsSent: 0, emailsFailed: 0 };
  try {
    const supabase = createAdminClient();
    const policy = AUDIENCE[input.eventType];
    if (!policy) {
      console.warn("[notify] no audience policy for event:", input.eventType);
      return summary;
    }

    // ── 1. Look up org branding for the email template + the org name
    //       on the in-app alert title. One round-trip, reused for the
    //       whole batch.
    const { data: orgRow } = await supabase
      .from("organizations")
      .select(
        "name, address, city, state, pin_code, gstin, pan, phone, email, logo_url",
      )
      .eq("id", input.organizationId)
      .single();
    const brand: BrandInfo = {
      name: orgRow?.name ?? "Your organisation",
      address: orgRow?.address ?? null,
      city: orgRow?.city ?? null,
      state: orgRow?.state ?? null,
      pin_code: orgRow?.pin_code ?? null,
      gstin: orgRow?.gstin ?? null,
      pan: orgRow?.pan ?? null,
      phone: orgRow?.phone ?? null,
      email: orgRow?.email ?? null,
      logoUrl: orgRow?.logo_url
        ? await signLogoUrl(supabase, orgRow.logo_url).catch(() => null)
        : null,
    };

    // ── 2. Load every profile in the org so we can filter by role.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, role, roles, full_name, notification_scope")
      .eq("org_id", input.organizationId);

    // Map auth.users emails — `profiles` doesn't carry an email field
    // (it's on auth.users) so we look them up separately.
    const userIds = (profiles ?? []).map((p) => p.id);
    const emailByUser = await fetchEmails(supabase, userIds);

    const allProfiles: ProfileRow[] = (profiles ?? []).map((p) => ({
      id: p.id,
      role: p.role,
      roles: p.roles ?? null,
      full_name: p.full_name ?? null,
      notification_scope: (p.notification_scope as "org" | "own" | null) ?? "org",
      email: emailByUser.get(p.id) ?? null,
    }));

    // ── 3. Filter to recipients matching the event's audience policy.
    const entityOwnerId = await resolveEntityOwner(
      supabase,
      input.entityType,
      input.entityId,
    );

    const eligible = allProfiles.filter((p) => {
      const userRoles = effectiveRoles(p);
      const audienceRoles = new Set<AudienceRole>(policy.roles);
      const matches = userRoles.some((r) =>
        audienceRoles.has(r as AudienceRole),
      );
      if (!matches) return false;
      // ownerOnlyForExec narrows executives whose scope is "own" and
      // who aren't the entity owner. Everyone else passes.
      if (policy.ownerOnlyForExec) {
        const isExecOnly = userRoles.every(
          (r) => !NEVER_NARROW.includes(r as AudienceRole),
        );
        if (isExecOnly && p.notification_scope === "own") {
          return entityOwnerId != null && entityOwnerId === p.id;
        }
      }
      return true;
    });

    if (eligible.length === 0) return summary;

    // ── 4. Pull per-user preferences so we know who wants email.
    //       Falls back to the policy's emailByDefault list when a
    //       user has no row.
    const prefMap = await fetchPreferences(
      supabase,
      input.organizationId,
      eligible.map((p) => p.id),
      input.eventType,
    );

    // ── 5. Insert in-app alert rows. Bulk upsert with onConflict
    //       does-nothing so the dedup index protects us.
    const severity: Severity = input.severity ?? "info";
    const link = input.link ?? defaultLinkFor(input);
    const rowsToInsert = eligible.map((p) => ({
      organization_id: input.organizationId,
      user_id: p.id,
      target_role: null,
      alert_type: input.eventType,
      title: input.title,
      message: input.message,
      severity,
      related_entity_type: input.entityType ?? null,
      related_entity_id: input.entityId ?? null,
      scheduled_for: new Date().toISOString(),
      scheduled_date: new Date().toISOString().slice(0, 10),
    }));
    const { error: insertErr, count } = await supabase
      .from("alerts")
      .upsert(rowsToInsert, {
        onConflict: "organization_id,alert_type,related_entity_id,scheduled_date",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (insertErr) {
      console.warn("[notify] alert insert failed:", insertErr.message);
    } else {
      summary.inAppInserted = count ?? rowsToInsert.length;
    }

    // ── 6. Email subset.
    const emailQueue = eligible.filter((p) => {
      if (!p.email) return false;
      const pref = prefMap.get(p.id);
      if (pref) return pref.email === true;
      // No explicit pref row — defer to the policy default for this
      // user's role.
      const roles = effectiveRoles(p);
      return roles.some((r) =>
        policy.emailByDefault.includes(r as AudienceRole),
      );
    });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || emailQueue.length === 0) {
      if (!apiKey && emailQueue.length > 0) {
        console.info(
          "[notify] RESEND_API_KEY not set — skipping " +
            emailQueue.length +
            " emails for " +
            input.eventType,
        );
      }
      return summary;
    }

    const ctaUrl = link.startsWith("http") ? link : `${APP_URL}${link}`;
    const html = renderBrandedEmail({
      brand,
      severity,
      preheader: input.message.slice(0, 140),
      title: input.title,
      bodyHtml: renderDefaultBody(input),
      ctaText: "View in app",
      ctaUrl,
    });
    const subject = `${brand.name}: ${input.title}`;

    // Fire emails in parallel — Resend's API handles 10 RPS easily;
    // we'll rarely exceed that per event.
    const results = await Promise.allSettled(
      emailQueue.map((p) =>
        sendResendEmail({
          apiKey,
          from: FROM_EMAIL,
          to: p.email!,
          subject,
          html,
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") summary.emailsSent += 1;
      else summary.emailsFailed += 1;
    }
    if (summary.emailsFailed > 0) {
      console.warn(
        "[notify] " + summary.emailsFailed + " emails failed for " + input.eventType,
      );
    }
    return summary;
  } catch (err) {
    // Notifications must never bring down the caller. Log + return.
    console.error("[notify] unhandled error:", err);
    return summary;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function effectiveRoles(p: ProfileRow): string[] {
  if (Array.isArray(p.roles) && p.roles.length > 0) return p.roles;
  return p.role ? [p.role] : [];
}

async function signLogoUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  logoPath: string,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from("org-logos")
    .createSignedUrl(logoPath, 60 * 60 * 4); // 4-hour window covers email caching well
  return data?.signedUrl ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchEmails(supabase: any, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  // auth.admin.getUserById is per-user — paginate via listUsers and
  // intersect locally so we make ONE API call total.
  const { data } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (!data?.users) return map;
  const targets = new Set(userIds);
  for (const u of data.users) {
    if (targets.has(u.id) && u.email) map.set(u.id, u.email);
  }
  return map;
}

async function fetchPreferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  userIds: string[],
  eventType: string,
): Promise<Map<string, { in_app: boolean; email: boolean }>> {
  const map = new Map<string, { in_app: boolean; email: boolean }>();
  if (userIds.length === 0) return map;
  const { data } = await supabase
    .from("alert_preferences")
    .select("user_id, in_app, email")
    .eq("organization_id", orgId)
    .eq("alert_type", eventType)
    .in("user_id", userIds);
  for (const row of (data ?? []) as Array<{ user_id: string; in_app: boolean; email: boolean }>) {
    map.set(row.user_id, { in_app: row.in_app, email: row.email });
  }
  return map;
}

async function resolveEntityOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  entityType: string | undefined,
  entityId: string | undefined,
): Promise<string | null> {
  if (!entityType || !entityId) return null;
  // Owner = created_by for these tables. campaign_sites / expenses /
  // invoices all carry that column.
  const table =
    entityType === "expense"
      ? "site_expenses"
      : entityType === "campaign"
        ? "campaigns"
        : entityType === "invoice"
          ? "invoices"
          : entityType === "site"
            ? "sites"
            : null;
  if (!table) return null;
  const { data } = await supabase
    .from(table)
    .select("created_by")
    .eq("id", entityId)
    .maybeSingle();
  return (data?.created_by as string | null) ?? null;
}

function defaultLinkFor(input: NotificationInput): string {
  const { entityType, entityId } = input;
  if (!entityType || !entityId) return "/dashboard";
  switch (entityType) {
    case "invoice":
      return `/billing/invoices/${entityId}`;
    case "campaign":
      return `/campaigns/${entityId}`;
    case "site":
      return `/sites/${entityId}`;
    case "expense":
      return `/finance/requests/${entityId}`;
    case "contract":
      return `/contracts/${entityId}`;
    case "contract_payment":
      return `/contracts`;
  }
}

function renderDefaultBody(input: NotificationInput): string {
  // Default body — paragraph plus optional details table built from
  // the caller's `data` map. Event-specific templates can replace
  // this in a follow-up commit; for P0 the generic body works.
  const rows = Object.entries(input.data ?? {})
    .filter(([, v]) => v != null && v !== "")
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:6px 12px 6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;white-space:nowrap;">${escapeHtml(k.replace(/_/g, " "))}</td>
          <td style="padding:6px 0;font-size:14px;color:#0F172A;font-weight:600;">${escapeHtml(String(v))}</td>
        </tr>`,
    )
    .join("");
  const details = rows
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${rows}</table>`
    : "";
  return `<p style="margin:0 0 8px 0;">${escapeHtml(input.message)}</p>${details}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendResendEmail(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`);
  }
}
