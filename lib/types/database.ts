// Database TypeScript types for the OOH Platform
// Manually maintained — regenerate with Supabase CLI when schema changes:
//   npx supabase gen types typescript --project-id <ref> > lib/types/database.ts
//
// These types map 1:1 to the SQL schema in supabase/migrations/

// Single role values allowed in profiles.role (primary role) and as elements
// of profiles.roles (multi-role set). sales_manager and operations_manager
// were consolidated into "executive" in migration 020.
export type UserRole =
  | "super_admin"
  | "admin"
  | "manager"
  | "executive"
  | "accounts"
  | "viewer";

export type SubscriptionTier = "free" | "starter" | "pro" | "enterprise";

export type MediaType =
  | "billboard"
  | "hoarding"
  | "dooh"
  | "kiosk"
  | "wall_wrap"
  | "unipole"
  | "bus_shelter"
  | "custom";

export type IlluminationType = "frontlit" | "backlit" | "digital" | "nonlit";
export type FacingDirection = "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW";
export type TrafficSide = "lhs" | "rhs" | "both";
export type OwnershipModel = "owned" | "rented";
export type StructureType = "permanent" | "temporary" | "digital";
export type SiteStatus = "available" | "booked" | "maintenance" | "blocked" | "expired";
export type PhotoType = "day" | "night" | "closeup" | "longshot" | "other";

// ─── organizations ───────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  settings: Record<string, unknown>;
  subscription_tier: SubscriptionTier;
  // Legacy: org-wide proposal / rate-card T&C. Superseded by the
  // per-document columns below (migration 040). Optional because the
  // column is not present on every environment yet.
  proposal_terms_template?: string | null;
  // Per-document T&C templates (migration 040) — each one pre-fills
  // the matching document builder. Null = no template set.
  invoice_terms_template: string | null;
  rate_card_terms_template: string | null;
  payment_voucher_terms_template: string | null;
  receipt_voucher_terms_template: string | null;
  created_at: string;
  updated_at: string;
}

export type OrganizationInsert = Pick<Organization, "name"> &
  Partial<
    Omit<Organization, "id" | "created_at" | "updated_at">
  >;

export type OrganizationUpdate = Partial<
  Omit<Organization, "id" | "created_at" | "updated_at">
>;

// ─── organization_bank_accounts ──────────────────────────────────────────────
// One row per bank account an organization wants to print on invoices.
// The user picks which account to use when creating each invoice, so the
// same org can bill into multiple accounts (current, escrow, project-
// specific etc.). Migration 032.

export type BankAccountType = "savings" | "current" | "other";

export interface OrganizationBankAccount {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  label: string | null;
  bank_name: string;
  account_holder_name: string | null;
  account_number: string;
  ifsc_code: string;
  branch_name: string | null;
  account_type: BankAccountType | null;
  upi_id: string | null;
  swift_code: string | null;

  is_primary: boolean;
  is_active: boolean;
  notes: string | null;
}

export type OrganizationBankAccountInsert = Omit<
  OrganizationBankAccount,
  "id" | "created_at" | "updated_at"
> & { id?: string };
export type OrganizationBankAccountUpdate = Partial<
  Omit<OrganizationBankAccount, "id" | "created_at" | "updated_at">
>;

// ─── profiles ────────────────────────────────────────────────────────────────

export interface Profile {
  id: string; // same as auth.users.id
  org_id: string | null;
  // Primary role (single value). Kept for backward-compat with RLS policies
  // and for the common case where a user has just one role.
  role: UserRole;
  // Full set of roles assigned to the user. For single-role users this is
  // just [role]; for the executive+accountant combo it's both values.
  // Always check `roles` when gating permissions that either role can grant.
  roles: UserRole[];
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileInsert = Pick<Profile, "id"> &
  Partial<Omit<Profile, "id" | "created_at" | "updated_at">>;

export type ProfileUpdate = Partial<
  Omit<Profile, "id" | "created_at" | "updated_at">
>;

// ─── sites ────────────────────────────────────────────────────────────────────

export interface Site {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  site_code: string;
  name: string;
  media_type: MediaType;
  structure_type: StructureType;
  status: SiteStatus;

  address: string;
  city: string;
  state: string;
  pincode: string | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;

  width_ft: number | null;
  height_ft: number | null;
  total_sqft: number | null; // generated column
  // Free-form extra dimensions beyond width/height (e.g. depth, pole height).
  // Persisted as JSONB on `sites.custom_dimensions`. Defaults to [].
  custom_dimensions: { label: string; value: string }[];

  illumination: IlluminationType | null;
  facing: FacingDirection | null;
  traffic_side: TrafficSide | null;
  visibility_distance_m: number | null;

  ownership_model: OwnershipModel;
  // Direct link to a landowner — only set when ownership_model = "owned".
  // Rented sites are linked to a partner_agency via the contracts table.
  landowner_id: string | null;
  // Stored as integer paise (1 INR = 100 paise). Display: value / 100.
  // Interpretation depends on pricing_basis — for per_kiosk_monthly
  // this is the rate per kiosk, for per_slot it's the rate per slot,
  // and so on. computeEffectiveMonthlyRate(site) is the helper that
  // collapses (basis × rate × units) into a comparable monthly figure.
  base_rate_paise: number | null;

  // Per-document pricing model + the count the rate multiplies against
  // (migration 041). Sane defaults preserve the legacy
  // "flat_monthly × 1" behaviour for old rows, so adoption is
  // incremental.
  pricing_basis: PricingBasis;
  billable_units: number;

  // Type-specific specs blob. Shape varies by media_type — see the
  // MediaSpecs discriminated union below. Null on legacy rows; the
  // form treats null as "no extra specs" and renders the flat
  // hoarding layout.
  media_specs: MediaSpecs | null;

  municipal_permission_number: string | null;
  municipal_permission_expiry: string | null; // DATE stored as ISO string

  notes: string | null;
  is_marketplace_listed: boolean;
  marketplace_visibility_settings: Record<string, unknown>;
}

// ─── Pricing model (migration 041) ────────────────────────────────────────
// Kept here next to Site since most consumers import both.

export type PricingBasis =
  | "flat_monthly" // hoarding, billboard, or unipole sold as a package
  | "per_face_monthly" // unipole sold per face
  | "per_kiosk_monthly" // kiosk strip, partial rentals OK
  | "per_panel_monthly" // bus shelter
  | "per_slot_monthly" // DOOH sold as a monthly slot package
  | "per_slot" // DOOH ad-hoc per-slot pricing
  | "per_second" // DOOH per-second pricing
  | "per_sqft_monthly" // wall wraps / irregular surfaces
  | "custom"; // escape hatch — totals ignored, rate displayed verbatim

// ─── Media-type-specific specs (migration 041) ────────────────────────────
// Discriminated union keyed by `kind`. Persisted on sites.media_specs
// as JSONB. Add new media types by extending the union — Postgres only
// stores the bytes, so no migration is needed for new shapes.

export interface MediaSpecsHoarding {
  kind: "billboard" | "hoarding";
  // No extra fields — width/height + facing/illumination on Site itself
  // are enough.
}

export interface MediaSpecsDooh {
  kind: "dooh";
  // How a DOOH loop is structured. Useful even when pricing is flat
  // monthly because clients ask "how many slots will I get?"
  slots_per_loop: number;
  slot_duration_seconds: number;
  loop_duration_seconds: number;
  operating_hours_per_day: number;
  // Optional context fields for buyers.
  screen_tech?: "led" | "lcd" | "p10" | "p6" | "other" | null;
  brightness_nits?: number | null;
  resolution_label?: string | null; // e.g. "1920×1080", "P10"
}

export interface MediaSpecsUnipoleSide {
  face: FacingDirection;
  width_ft: number;
  height_ft: number;
  illumination: IlluminationType;
}

export interface MediaSpecsUnipole {
  kind: "unipole";
  // Physical configuration.
  shape: "single" | "L" | "T" | "V";
  sides: MediaSpecsUnipoleSide[];
  // Sales mode — defaults to "package" per the builder's preference.
  // When `per_face`, base_rate_paise is the per-face monthly and
  // billable_units = sides.length (or however many are available).
  sale_mode: "package" | "per_face";
}

export interface MediaSpecsKiosk {
  kind: "kiosk";
  // Total kiosks in the strip and how many we can sell. Partial
  // rentals are allowed (3 of 8) — a campaign just sets its own
  // billable_units on the booking. The Site-level units field reflects
  // current availability.
  kiosk_count: number;
  kiosks_sellable: number;
  kiosk_dimensions_ft?: { width: number; height: number } | null;
}

export interface MediaSpecsBusShelter {
  kind: "bus_shelter";
  panel_count: number;
  lit_panels: number;
  seating_capacity?: number | null;
}

export interface MediaSpecsWallWrap {
  kind: "wall_wrap";
  area_sqft: number;
  ceiling_height_ft?: number | null;
  irregular_shape: boolean;
}

export interface MediaSpecsCustom {
  kind: "custom";
  notes: string;
}

export type MediaSpecs =
  | MediaSpecsHoarding
  | MediaSpecsDooh
  | MediaSpecsUnipole
  | MediaSpecsKiosk
  | MediaSpecsBusShelter
  | MediaSpecsWallWrap
  | MediaSpecsCustom;

export type SiteInsert = Omit<Site, "id" | "created_at" | "updated_at" | "total_sqft"> & {
  id?: string;
};

export type SiteUpdate = Partial<Omit<Site, "id" | "created_at" | "updated_at" | "total_sqft">>;

// ─── site_photos ──────────────────────────────────────────────────────────────

export interface SitePhoto {
  id: string;
  organization_id: string;
  site_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;

  photo_url: string;
  photo_type: PhotoType;
  is_primary: boolean;
  sort_order: number;

  // Optional campaign provenance. NULL means "plain site photo".
  // Non-NULL means the photo was uploaded against a specific campaign
  // (and optionally the exact campaign_site row). See migration 034.
  campaign_id: string | null;
  campaign_site_id: string | null;
}

export type SitePhotoInsert = Omit<SitePhoto, "id" | "created_at" | "updated_at">;

// ─── landowners ───────────────────────────────────────────────────────────────

export interface Landowner {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  full_name: string;
  phone: string | null;
  phone_alt: string | null;
  email: string | null;

  address: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;

  // Sensitive — stored as plain text, encrypt in production
  pan_number: string | null;
  aadhaar_reference: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;

  notes: string | null;
}

export type LandownerInsert = Omit<Landowner, "id" | "created_at" | "updated_at"> & { id?: string };
export type LandownerUpdate = Partial<Omit<Landowner, "id" | "created_at" | "updated_at">>;

// ─── partner_agencies ─────────────────────────────────────────────────────────

export interface PartnerAgency {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  agency_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;

  address: string | null;
  city: string | null;
  state: string | null;

  notes: string | null;
}

export type PartnerAgencyInsert = Omit<PartnerAgency, "id" | "created_at" | "updated_at"> & { id?: string };
export type PartnerAgencyUpdate = Partial<Omit<PartnerAgency, "id" | "created_at" | "updated_at">>;

// ─── contracts ────────────────────────────────────────────────────────────────

export type ContractType = "landowner" | "agency";
export type ContractPaymentModel = "monthly_fixed" | "yearly_lumpsum" | "revenue_share" | "custom";
export type ContractStatus = "active" | "expired" | "terminated" | "pending_renewal";
export type PaymentStatus = "upcoming" | "due" | "paid" | "overdue" | "partially_paid";

export interface Contract {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  contract_type: ContractType;
  landowner_id: string | null;
  agency_id: string | null;
  site_id: string;

  payment_model: ContractPaymentModel;
  rent_amount_paise: number | null;
  payment_day_of_month: number | null;
  payment_date: string | null;
  revenue_share_percentage: number | null;
  minimum_guarantee_paise: number | null;
  escalation_percentage: number | null;
  escalation_frequency_months: number | null;

  start_date: string;
  end_date: string | null;
  renewal_date: string | null;
  notice_period_days: number;
  lock_period_months: number | null;
  early_termination_clause: string | null;

  status: ContractStatus;
  contract_document_url: string | null;
  // Counter-signed copy of the agreement (once both parties have executed).
  signed_document_url: string | null;
  // Free-form T&C clauses ({title, content}[]). Added in migration 025.
  terms_clauses: { title: string; content: string }[];
  notes: string | null;
}

export interface SignedAgreement {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  title: string;
  counterparty_type: "landowner" | "agency" | "client" | "other" | null;
  landowner_id: string | null;
  agency_id: string | null;
  client_id: string | null;
  site_id: string | null;
  agreement_date: string | null;
  document_url: string;
  notes: string | null;
}

export type ContractInsert = Omit<Contract, "id" | "created_at" | "updated_at"> & { id?: string };
export type ContractUpdate = Partial<Omit<Contract, "id" | "created_at" | "updated_at">>;

// ─── contract_amendments ──────────────────────────────────────────────────────

export interface ContractAmendment {
  id: string;
  organization_id: string;
  contract_id: string;
  created_at: string;
  created_by: string | null;

  amendment_date: string;
  description: string;
  old_terms: Record<string, unknown> | null;
  new_terms: Record<string, unknown> | null;
  document_url: string | null;
}

// ─── contract_payments ────────────────────────────────────────────────────────

export interface ContractPayment {
  id: string;
  organization_id: string;
  contract_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;

  due_date: string;
  amount_due_paise: number;
  amount_paid_paise: number | null;

  payment_date: string | null;
  payment_mode: "cash" | "cheque" | "bank_transfer" | "upi" | "online" | null;
  payment_reference: string | null;

  tds_deducted_paise: number | null;
  tds_percentage: number | null;

  status: PaymentStatus;
  notes: string | null;
}

export type ContractPaymentInsert = Omit<ContractPayment, "id" | "created_at" | "updated_at"> & { id?: string };
export type ContractPaymentUpdate = Partial<Omit<ContractPayment, "id" | "created_at" | "updated_at">>;

// ─── clients ──────────────────────────────────────────────────────────────────

export type CreditTerms = "advance" | "net15" | "net30" | "net60";

export interface Client {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  company_name: string;
  brand_name: string | null;
  industry_category: string | null;

  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;

  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  secondary_contact_email: string | null;

  billing_contact_name: string | null;
  billing_contact_phone: string | null;
  billing_contact_email: string | null;

  gstin: string | null;
  pan: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_pin_code: string | null;

  credit_terms: CreditTerms;
  notes: string | null;
}

export type ClientInsert = Omit<Client, "id" | "created_at" | "updated_at"> & { id?: string };
export type ClientUpdate = Partial<Omit<Client, "id" | "created_at" | "updated_at">>;

// ─── campaigns ────────────────────────────────────────────────────────────────

// Simplified in migration 035. Previously had 10 workflow statuses
// (enquiry → proposal_sent → … → completed); the team wanted to skip
// the pre-live ceremony entirely, so a created campaign is LIVE by
// default, flips to COMPLETED when end_date has passed (via the
// auto-complete cron), and CANCELLED is a manual terminal state.
export type CampaignStatus = "live" | "completed" | "cancelled";

export type SiteRateType = "per_month" | "fixed";
export type ServiceRateBasis = "per_sqft" | "lumpsum" | "other";

export type PricingType = "itemized" | "bundled";

export interface Campaign {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  campaign_code: string | null;
  // For 'client' and 'client_on_behalf_of_agency' modes: the billed client.
  // For 'agency' mode: optional reference to the agency's end customer.
  client_id: string | null;
  campaign_name: string;

  start_date: string | null;
  end_date: string | null;

  status: CampaignStatus;
  total_value_paise: number | null;
  pricing_type: PricingType;
  notes: string | null;

  // ── Billing model (migration 024) ───────────────────────────────────────
  billing_party_type: "client" | "agency" | "client_on_behalf_of_agency";
  // Required when billing_party_type !== 'client'. null for direct-client deals.
  billed_agency_id: string | null;
  // Commission owed to the agency. Only populated for
  // 'client_on_behalf_of_agency'. Percentage and fixed-paise are alternatives —
  // app layer picks whichever is non-null (fixed wins if both are set).
  agency_commission_percentage: number | null;
  agency_commission_paise: number | null;
}

export type CampaignInsert = Omit<Campaign, "id" | "created_at" | "updated_at"> & { id?: string };
export type CampaignUpdate = Partial<Omit<Campaign, "id" | "created_at" | "updated_at">>;

// ─── campaign_sites ───────────────────────────────────────────────────────────

export type CampaignSiteStatus =
  | "pending"
  | "creative_received"
  | "printing"
  | "mounted"
  | "live"
  | "dismounted";

export interface CampaignSite {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;

  campaign_id: string;
  site_id: string;

  rate_type: SiteRateType;
  display_rate_paise: number | null;
  start_date: string | null;
  end_date: string | null;

  creative_file_url: string | null;
  creative_size_width: number | null;
  creative_size_height: number | null;

  mounting_date: string | null;
  dismounting_date: string | null;
  mounting_photo_url: string | null;

  status: CampaignSiteStatus;
  notes: string | null;
}

export type CampaignSiteInsert = Omit<CampaignSite, "id" | "created_at" | "updated_at"> & { id?: string };
export type CampaignSiteUpdate = Partial<Omit<CampaignSite, "id" | "created_at" | "updated_at">>;

// ─── campaign_services ────────────────────────────────────────────────────────

export type ServiceType =
  | "display_rental"
  | "flex_printing"
  | "mounting"
  | "design"
  | "transport"
  | "other";

export interface CampaignService {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;

  campaign_id: string;
  site_id: string | null;

  service_type: ServiceType;
  description: string | null;
  quantity: number;
  rate_paise: number;
  total_paise: number;
  rate_basis: ServiceRateBasis;
  other_label: string | null;
}

export type CampaignServiceInsert = Omit<CampaignService, "id" | "created_at" | "updated_at"> & { id?: string };
export type CampaignServiceUpdate = Partial<Omit<CampaignService, "id" | "created_at" | "updated_at">>;

// ─── campaign_activity_log ────────────────────────────────────────────────────

export type CampaignActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "status_changed"
  | "note_added"
  | "file_uploaded"
  | "payment_received"
  | "site_added"
  | "site_removed"
  | "service_added"
  | "service_removed"
  | "service_updated"
  | "job_added"
  | "job_updated"
  | "job_removed"
  | "change_requested"
  | "change_approved"
  | "change_rejected";

export interface CampaignActivityLog {
  id: string;
  organization_id: string;
  created_at: string;

  campaign_id: string;
  user_id: string | null;

  action: CampaignActivityAction;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
}

// ─── campaign_change_requests ─────────────────────────────────────────────────

export type ChangeRequestStatus = "pending" | "approved" | "rejected";

export interface CampaignChangeRequest {
  id: string;
  organization_id: string;
  campaign_id: string;
  requested_by: string;
  reviewed_by: string | null;
  status: ChangeRequestStatus;
  reason: string;
  rejection_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignChangeRequestInsert = Omit<CampaignChangeRequest, "id" | "created_at" | "updated_at"> & { id?: string };

// ─── invoices ─────────────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface Invoice {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  invoice_number: string;
  client_id: string;
  campaign_id: string | null;

  invoice_date: string;
  due_date: string;

  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  amount_paid_paise: number;
  balance_due_paise: number;

  supplier_gstin: string | null;
  buyer_gstin: string | null;
  place_of_supply_state: string | null;
  is_inter_state: boolean;
  sac_code: string;

  status: InvoiceStatus;
  notes: string | null;
  terms_and_conditions: string | null;
  pdf_url: string | null;

  // FK to organization_bank_accounts — which bank account to print on
  // the invoice PDF. Nullable so older invoices continue to render.
  bank_account_id: string | null;
}

export type InvoiceInsert = Omit<Invoice, "id" | "created_at" | "updated_at"> & { id?: string };
export type InvoiceUpdate = Partial<Omit<Invoice, "id" | "created_at" | "updated_at">>;

// ─── invoice_line_items ───────────────────────────────────────────────────────

export interface InvoiceLineItem {
  id: string;
  organization_id: string;
  invoice_id: string;
  created_at: string;

  site_id: string | null;
  service_type: ServiceType;
  description: string;
  hsn_sac_code: string;

  quantity: number;
  rate_paise: number;
  amount_paise: number;

  period_from: string | null;
  period_to: string | null;
}

export type InvoiceLineItemInsert = Omit<InvoiceLineItem, "id" | "created_at"> & { id?: string };

// ─── payments_received ────────────────────────────────────────────────────────

export type PaymentMode = "cash" | "cheque" | "bank_transfer" | "upi" | "online";

export interface PaymentReceived {
  id: string;
  organization_id: string;
  created_at: string;
  created_by: string | null;

  invoice_id: string;
  client_id: string;

  amount_paise: number;
  payment_date: string;
  payment_mode: PaymentMode;
  reference_number: string | null;
  bank_name: string | null;
  notes: string | null;
  receipt_number: string | null;
}

export type PaymentReceivedInsert = Omit<PaymentReceived, "id" | "created_at"> & { id?: string };

// ─── proposals ────────────────────────────────────────────────────────────────

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "rejected";
export type TemplateType = "grid" | "list" | "one_per_page" | "compact";
export type ShowRatesType = "exact" | "range" | "request_quote" | "hidden";

export interface Proposal {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  proposal_name: string;
  // Recipient can be a direct client or a partner agency (see
  // migration 039). recipient_type is the explicit hint for the UI;
  // exactly one of client_id / agency_id is populated when
  // recipient_type is set, both NULL otherwise.
  client_id: string | null;
  agency_id: string | null;
  recipient_type: "client" | "agency" | null;

  template_type: TemplateType;
  show_rates: ShowRatesType;
  show_photos: boolean;
  show_map: boolean;
  show_dimensions: boolean;
  show_illumination: boolean;
  show_traffic_info: boolean;
  show_availability: boolean;

  include_company_branding: boolean;
  include_terms: boolean;
  terms_text: string | null;
  include_contact_details: boolean;
  custom_header_text: string | null;
  custom_footer_text: string | null;

  status: ProposalStatus;
  sent_to_email: string | null;
  sent_at: string | null;
  viewed_at: string | null;

  pdf_url: string | null;
  pptx_url: string | null;
  notes: string | null;
}

export type ProposalInsert = Omit<Proposal, "id" | "created_at" | "updated_at"> & { id?: string };
export type ProposalUpdate = Partial<Omit<Proposal, "id" | "created_at" | "updated_at">>;

// ─── proposal_sites ───────────────────────────────────────────────────────────

export interface ProposalSite {
  id: string;
  organization_id: string;
  proposal_id: string;
  site_id: string;
  created_at: string;

  custom_rate_paise: number | null;
  custom_notes: string | null;
  display_order: number;
}

export type ProposalSiteInsert = Omit<ProposalSite, "id" | "created_at"> & { id?: string };

// ─── Alert Types ──────────────────────────────────────────────────────────────

export type AlertType =
  | "payment_due"
  | "payment_overdue"
  | "contract_renewal"
  | "campaign_ending"
  | "site_available"
  | "municipal_expiry"
  | "invoice_overdue"
  | "mounting_scheduled";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEntityType = "contract" | "campaign" | "invoice" | "site" | "contract_payment";

export interface Alert {
  id: string;
  organization_id: string;
  user_id: string | null;
  target_role: string | null;
  alert_type: AlertType;
  title: string;
  message: string;
  severity: AlertSeverity;
  related_entity_type: AlertEntityType | null;
  related_entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  is_dismissed: boolean;
  scheduled_for: string;
  sent_email: boolean;
  sent_whatsapp: boolean;
  created_at: string;
}

export interface AlertPreference {
  id: string;
  organization_id: string;
  user_id: string | null;
  role: string | null;
  alert_type: AlertType;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
  advance_days: number[];
  created_at: string;
  updated_at: string;
}

export type AlertPreferenceUpsert = Omit<AlertPreference, "id" | "created_at" | "updated_at"> & { id?: string };

// ─── site_expenses (payment requests) ────────────────────────────────────────

export type ExpenseCategory =
  | "electricity"
  | "rent"
  | "maintenance"
  | "cleaning"
  | "light_change"
  | "repair"
  | "permit_fee"
  | "printing"
  | "mounting"
  | "fuel_transport"
  | "other";

export type ExpenseStatus = "pending" | "approved" | "paid" | "rejected";

export type ExpensePayeeType =
  | "landowner"
  | "agency"
  | "vendor"
  | "contractor"
  | "employee"
  | "other";

export interface SiteExpense {
  id: string;
  organization_id: string;
  site_id: string | null;
  // Optional campaign link — set when the payment request relates to a
  // specific booking (e.g. flex print/mount for a particular campaign).
  // Left NULL for overhead expenses that aren't tied to any campaign.
  campaign_id: string | null;

  category: ExpenseCategory;
  description: string;
  amount_paise: number;

  payee_type: ExpensePayeeType;
  payee_id: string | null;
  payee_name: string;
  payee_contact: string | null;
  payee_bank_details: Record<string, unknown> | null;

  status: ExpenseStatus;

  needed_by: string | null;

  paid_at: string | null;
  paid_by: string | null;
  payment_mode: PaymentMode | null;
  payment_reference: string | null;
  tds_paise: number | null;

  receipt_doc_urls: string[];
  payment_proof_urls: string[];

  notes: string | null;

  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
}

export type SiteExpenseInsert = Omit<
  SiteExpense,
  "id" | "created_at" | "updated_at" | "deleted_at"
> & { id?: string };

// ─── campaign_jobs ──────────────────────────────────────────────────────────
// Print / mount / unmount / repair tasks attached to a campaign. Each job is
// either handled in-house (source='internal') or outsourced to a vendor
// (source='external'). External jobs with a cost can spawn a site_expenses
// row (payment request) for the accounts team to approve + pay, via the
// linked expense_id column.
export type CampaignJobType =
  | "print"
  | "mount"
  | "print_and_mount"
  | "unmount"
  | "repair"
  | "other";

export type CampaignJobSource = "internal" | "external";

export type CampaignJobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface CampaignJob {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;

  campaign_id: string;
  campaign_site_id: string | null;
  site_id: string | null;

  job_type: CampaignJobType;
  source: CampaignJobSource;

  vendor_name: string | null;
  vendor_agency_id: string | null;
  vendor_contact: string | null;

  status: CampaignJobStatus;
  scheduled_date: string | null;
  completed_date: string | null;

  cost_paise: number | null;
  expense_id: string | null;

  description: string;
  notes: string | null;
}

export type CampaignJobInsert = Omit<
  CampaignJob,
  "id" | "created_at" | "updated_at" | "deleted_at"
> & { id?: string };

// ─── Supabase Database type (for use with createClient<Database>()) ──────────
// Extend this as more tables are added.

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: OrganizationInsert;
        Update: OrganizationUpdate;
      };
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
      sites: {
        Row: Site;
        Insert: SiteInsert;
        Update: SiteUpdate;
      };
      site_photos: {
        Row: SitePhoto;
        Insert: SitePhotoInsert;
        Update: Partial<Omit<SitePhoto, "id" | "created_at" | "updated_at">>;
      };
    };
    Functions: {
      get_user_org_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
    };
    Enums: {
      media_type_enum: MediaType;
      site_status_enum: SiteStatus;
      ownership_model_enum: OwnershipModel;
      structure_type_enum: StructureType;
      illumination_enum: IlluminationType;
      facing_enum: FacingDirection;
      traffic_side_enum: TrafficSide;
      photo_type_enum: PhotoType;
    };
  };
}
