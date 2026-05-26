// Notification event types. One per row in the matrix in our
// notifications plan. The set here is the full P0 + P1 list — values
// must stay in sync with the alert_type CHECK in migration 011 + 043.
//
// When you add a new event:
//   1. Append to NotificationEvent below
//   2. Add it to the CHECK list in the migration (or write a new one)
//   3. Decide the audience in lib/notifications/audience.ts
//   4. (Optional) add a per-event template in lib/notifications/templates/

export type NotificationEvent =
  // Invoice / receivables
  | "invoice_sent"
  | "invoice_paid"
  | "invoice_overdue"
  // Payables — landowner rent etc.
  | "payment_due"
  | "payment_overdue"
  // Payment requests / expenses
  | "expense_approved"
  | "expense_rejected"
  | "expense_paid"
  // Campaign lifecycle
  | "campaign_starting"
  | "campaign_ending"
  | "campaign_completed"
  | "campaign_cancelled"
  // Sites / inventory
  | "site_available"
  | "mounting_scheduled"
  | "municipal_expiry"
  // Contracts
  | "contract_renewal"
  // System
  | "cron_failure";

export type EntityType =
  | "invoice"
  | "campaign"
  | "site"
  | "contract"
  | "contract_payment"
  | "expense";

export type Severity = "info" | "warning" | "critical";

export interface NotificationInput {
  // Always required so we can scope every notification to one tenant.
  organizationId: string;
  eventType: NotificationEvent;
  // The thing the notification is about — used for click-through
  // links + dedup. Can be omitted for events that aren't tied to a
  // single row (system-wide stuff).
  entityType?: EntityType;
  entityId?: string;
  // Human-readable strings. The dispatcher passes these straight into
  // the alerts table AND the email template, so callers should think
  // of them as "what the recipient ultimately sees".
  title: string;
  message: string;
  // Visual urgency. "critical" gets a red bar in the bell + red
  // highlight in the email header. Default "info".
  severity?: Severity;
  // Where the in-app row should link to when clicked. Relative URL.
  // E.g. `/billing/invoices/<id>`. Optional — falls back to a sensible
  // default per event.
  link?: string;
  // Extra data the template can use to make the email body specific.
  // E.g. for invoice_paid: { invoiceNumber, amountFormatted, clientName }.
  // Keep it small and JSON-serialisable.
  data?: Record<string, string | number | null | undefined>;
}
