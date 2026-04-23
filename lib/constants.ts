// App-wide constants — statuses, media types, roles used across the application

// User roles (matches profiles.role column + profiles.roles elements).
// sales_manager and operations_manager were merged into "executive" in
// migration 020. A user can additionally hold the {executive, accounts}
// combo via profiles.roles — see USER_ROLE_COMBOS below.
export const USER_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "executive",
  "accounts",
  "viewer",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Roles that can be combined (multi-select) on a single user.
// Today the only valid combo is {executive, accounts}. The Users UI uses this
// to decide when to show checkboxes vs. a single-select.
export const COMBINABLE_ROLES: ReadonlyArray<UserRole> = ["executive", "accounts"];

// Helper: true when a role set is a valid {executive, accounts} combo.
export function isExecutiveAccountsCombo(roles: readonly UserRole[]): boolean {
  return (
    roles.length === 2 &&
    roles.includes("executive") &&
    roles.includes("accounts")
  );
}

// Site media types
export const MEDIA_TYPES = [
  "billboard",
  "hoarding",
  "dooh",
  "kiosk",
  "wall_wrap",
  "unipole",
  "bus_shelter",
  "custom",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

// Site statuses
export const SITE_STATUSES = [
  "available",
  "booked",
  "maintenance",
  "blocked",
  "expired",
] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

// Campaign statuses. Simplified in migration 035 — see
// lib/types/database.ts for the rationale.
export const CAMPAIGN_STATUSES = [
  "live",
  "completed",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// Invoice statuses
export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// Payable statuses
export const PAYABLE_STATUSES = [
  "upcoming",
  "due",
  "paid",
  "overdue",
] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

// Payment modes
export const PAYMENT_MODES = [
  "cash",
  "cheque",
  "bank_transfer",
  "upi",
  "online",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

// Contract types
export const CONTRACT_TYPES = ["landowner", "agency"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

// Contract payment models
export const PAYMENT_MODELS = [
  "monthly_fixed",
  "yearly_lumpsum",
  "revenue_share",
  "custom",
] as const;
export type PaymentModel = (typeof PAYMENT_MODELS)[number];

// Site illumination types
export const ILLUMINATION_TYPES = [
  "frontlit",
  "backlit",
  "digital",
  "nonlit",
] as const;
export type IlluminationType = (typeof ILLUMINATION_TYPES)[number];

// Site facing directions
export const FACING_DIRECTIONS = [
  "N", "S", "E", "W", "NE", "NW", "SE", "SW",
] as const;
export type FacingDirection = (typeof FACING_DIRECTIONS)[number];

// Ownership models
export const OWNERSHIP_MODELS = ["owned", "rented"] as const;
export type OwnershipModel = (typeof OWNERSHIP_MODELS)[number];

// Credit terms
export const CREDIT_TERMS = ["advance", "net15", "net30", "net60"] as const;
export type CreditTerms = (typeof CREDIT_TERMS)[number];

// Default GST rate for OOH advertising (SAC: 998361)
export const DEFAULT_GST_RATE = 18;
export const OOH_SAC_CODE = "998361";

// Default invoice number format
export const INVOICE_NUMBER_FORMAT = "INV-{YYYY}-{MM}-{SEQ}";

// Max file sizes
export const MAX_PHOTO_SIZE_MB = 5;
export const MAX_DOCUMENT_SIZE_MB = 10;

// Pagination
export const DEFAULT_PAGE_SIZE = 50;
