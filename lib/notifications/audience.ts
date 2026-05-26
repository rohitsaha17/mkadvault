// Per-event audience policy. Single source of truth for "who gets
// notified about X event" — referenced by lib/notifications/dispatch.ts
// when fanning out an event to recipients.
//
// Mirrors the matrix in our notification plan. Keep this file small
// and declarative so adding new events is just adding a row.

import type { NotificationEvent } from "./types";

// Roles that can receive notifications. Matches the existing role
// enum in the app (profiles.role + profiles.roles[]). "executive"
// can be additionally narrowed via profiles.notification_scope.
export type AudienceRole =
  | "super_admin"
  | "admin"
  | "manager"
  | "accounts"
  | "executive";

// For each event:
//   roles[]              — which roles to consider
//   emailByDefault       — roles that get an email out of the box
//                          (the rest only get an in-app alert unless
//                          their per-user alert_preferences turn email on)
//   ownerOnlyForExec     — when true, the dispatcher only delivers to
//                          executives whose notification_scope = "org"
//                          OR who are the entity's owner. Used for
//                          "this is your campaign" style events.
export interface AudiencePolicy {
  roles: AudienceRole[];
  emailByDefault: AudienceRole[];
  ownerOnlyForExec?: boolean;
}

const ADMIN_ROLES: AudienceRole[] = ["super_admin", "admin"];
const FINANCE_ROLES: AudienceRole[] = ["super_admin", "admin", "accounts"];
const OPS_ROLES: AudienceRole[] = [
  "super_admin",
  "admin",
  "manager",
  "executive",
];

export const AUDIENCE: Record<NotificationEvent, AudiencePolicy> = {
  // ── Receivables (Accounts + Admin)
  invoice_sent: {
    roles: FINANCE_ROLES,
    emailByDefault: ["accounts"],
  },
  invoice_paid: {
    roles: [...FINANCE_ROLES, "executive"],
    emailByDefault: ["accounts"],
    // Executives who own the linked campaign get notified; "org"-scope
    // executives get it regardless.
    ownerOnlyForExec: true,
  },
  invoice_overdue: {
    roles: FINANCE_ROLES,
    emailByDefault: ["accounts", "admin"],
  },

  // ── Payables — landowner rent etc.
  payment_due: {
    roles: FINANCE_ROLES,
    emailByDefault: ["accounts"],
  },
  payment_overdue: {
    roles: FINANCE_ROLES,
    emailByDefault: ["accounts", "admin"],
  },

  // ── Payment requests (executive who raised it + finance approvers)
  expense_approved: {
    roles: [...FINANCE_ROLES, "executive"],
    emailByDefault: ["accounts"],
    // Approval is targeted at the requester — only the owning exec
    // gets it once they've raised the request.
    ownerOnlyForExec: true,
  },
  expense_rejected: {
    roles: [...ADMIN_ROLES, "manager", "executive"],
    emailByDefault: [],
    ownerOnlyForExec: true,
  },
  expense_paid: {
    roles: [...FINANCE_ROLES, "executive"],
    emailByDefault: ["accounts"],
    ownerOnlyForExec: true,
  },

  // ── Campaign lifecycle
  campaign_starting: {
    roles: OPS_ROLES,
    emailByDefault: ["manager"],
    ownerOnlyForExec: true,
  },
  campaign_ending: {
    roles: OPS_ROLES,
    emailByDefault: ["manager"],
    ownerOnlyForExec: true,
  },
  campaign_completed: {
    roles: [...OPS_ROLES, "accounts"],
    emailByDefault: [],
    ownerOnlyForExec: true,
  },
  campaign_cancelled: {
    roles: [...OPS_ROLES, "accounts"],
    emailByDefault: ["admin", "manager", "accounts"],
  },

  // ── Sites
  site_available: {
    roles: OPS_ROLES,
    emailByDefault: [],
  },
  mounting_scheduled: {
    roles: OPS_ROLES,
    emailByDefault: ["manager", "executive"],
    // Mounting alerts go to ALL executives today — there's no crew
    // assignment column yet. Owner-only would silence the field
    // team that's actually expected to show up.
    ownerOnlyForExec: false,
  },
  municipal_expiry: {
    roles: [...ADMIN_ROLES, "manager", "executive"],
    emailByDefault: ["admin", "manager"],
  },

  // ── Contracts
  contract_renewal: {
    roles: [...FINANCE_ROLES, "manager"],
    emailByDefault: ["admin", "manager"],
  },

  // ── System
  cron_failure: {
    roles: ADMIN_ROLES,
    emailByDefault: ADMIN_ROLES,
  },
};
