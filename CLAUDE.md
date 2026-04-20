# CLAUDE.md — OOH Business Management & Marketplace Platform

## Project Overview

This is an outdoor advertising (OOH) business management platform built in two phases:
- **Phase 1**: Internal tool for managing our own OOH agency operations (sites, contracts, clients, billing, reports)
- **Phase 2**: Multi-tenant marketplace where multiple agencies manage their businesses AND trade/sell advertising inventory to each other and direct clients

The builder has minimal coding experience and is building entirely with Claude Code. Prioritize simple, readable code over clever abstractions. Explain decisions in comments. Avoid premature optimization.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | **Next.js 14+ (App Router)** | Use App Router (`/app` directory), NOT Pages Router |
| Language | **TypeScript** | Strict mode. All files `.ts` / `.tsx` |
| UI | **shadcn/ui + Tailwind CSS** | Install components via CLI (`npx shadcn-ui@latest add <component>`). No custom CSS unless absolutely necessary |
| Database | **Supabase (PostgreSQL)** | Use Supabase client library. Row Level Security (RLS) on ALL tables |
| Auth | **Supabase Auth** | Email/password + magic link. Role stored in `profiles` table |
| Storage | **Supabase Storage** | Buckets: `site-photos`, `contracts`, `invoices`, `creatives`, `proposals` |
| Maps | **Google Maps JavaScript API** | For site GPS mapping, map search, marker clusters |
| PDF Export | **@react-pdf/renderer** | For invoices and proposals |
| PPTX Export | **pptxgenjs** | For PowerPoint proposal generation |
| Email | **Resend** | Transactional emails (reminders, invoices) |
| i18n | **next-intl** | Multi-language support. Default: English + Hindi |
| Hosting | **Vercel** | Auto-deploy from `main` branch |
| Package Manager | **pnpm** | Use `pnpm` for all installs, NOT npm or yarn |

---

## Project Structure

```
/
├── app/
│   ├── (auth)/                  # Auth pages (login, signup, forgot-password)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/             # Protected app pages
│   │   ├── layout.tsx           # Sidebar + topbar layout
│   │   ├── page.tsx             # Dashboard home
│   │   ├── sites/               # Site & inventory management
│   │   │   ├── page.tsx         # Site list (table + map toggle)
│   │   │   ├── [id]/page.tsx    # Site detail view
│   │   │   ├── new/page.tsx     # Add new site
│   │   │   └── calendar/page.tsx # Availability calendar view
│   │   ├── landowners/          # Landowner management
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── agencies/            # Partner agency management
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── clients/             # Client management
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── campaigns/           # Campaign / booking management
│   │   │   ├── page.tsx         # Kanban board view
│   │   │   ├── [id]/page.tsx
│   │   │   └── new/page.tsx
│   │   ├── billing/             # Invoicing & payments
│   │   │   ├── invoices/page.tsx
│   │   │   ├── payables/page.tsx
│   │   │   └── aging/page.tsx
│   │   ├── proposals/           # Proposal builder
│   │   │   ├── page.tsx
│   │   │   └── builder/page.tsx
│   │   ├── reports/             # Reports & analytics
│   │   │   └── page.tsx
│   │   └── settings/            # User, role, company settings
│   │       └── page.tsx
│   ├── api/                     # API routes (if needed beyond Supabase)
│   └── layout.tsx               # Root layout
├── components/
│   ├── ui/                      # shadcn/ui components (auto-generated)
│   ├── sites/                   # Site-specific components
│   ├── billing/                 # Billing-specific components
│   ├── campaigns/               # Campaign-specific components
│   ├── proposals/               # Proposal builder components
│   ├── dashboard/               # Dashboard widgets
│   ├── layout/                  # Sidebar, topbar, navigation
│   └── shared/                  # Reusable components (data table, status badge, etc.)
├── lib/
│   ├── supabase/
│   │   ├── client.ts            # Browser Supabase client
│   │   ├── server.ts            # Server Supabase client
│   │   └── admin.ts             # Admin client (service role, use sparingly)
│   ├── utils.ts                 # General utilities (cn, formatCurrency, formatDate)
│   ├── constants.ts             # App-wide constants (statuses, media types, roles)
│   ├── types.ts                 # TypeScript types matching DB schema
│   └── validations.ts           # Zod schemas for form validation
├── hooks/                       # Custom React hooks
│   ├── use-sites.ts
│   ├── use-campaigns.ts
│   └── use-auth.ts
├── messages/                    # i18n translation files
│   ├── en.json
│   └── hi.json
├── supabase/
│   └── migrations/              # SQL migration files
├── public/                      # Static assets
└── CLAUDE.md                    # This file
```

---

## Database Schema (Supabase / PostgreSQL)

### Core Tables

**IMPORTANT**: Every table MUST have these columns:
- `id` — UUID, primary key, default `gen_random_uuid()`
- `created_at` — timestamptz, default `now()`
- `updated_at` — timestamptz, auto-updated via trigger
- `created_by` — UUID, references `auth.users(id)`
- `organization_id` — UUID, references `organizations(id)` — THIS IS THE TENANT ID, required for multi-tenant isolation

#### organizations
The tenant table. Phase 1 = one row (our agency). Phase 2 = one row per agency.
```
- id, name, logo_url, address, city, state, pincode
- gstin, pan, contact_email, contact_phone
- subscription_tier (free | starter | pro | enterprise) — for Phase 2
- settings (jsonb) — org-level preferences
```

#### profiles (extends Supabase auth.users)
```
- id (same as auth.users.id), organization_id
- full_name, phone, avatar_url
- role (super_admin | sales_manager | operations_manager | accounts | admin | viewer)
- is_active, last_login_at
```

#### sites
```
- id, organization_id, site_code (e.g., "MUM-BKC-001")
- name, media_type (billboard | hoarding | dooh | kiosk | wall_wrap | unipole | bus_shelter | custom)
- address, city, state, pincode, landmark
- latitude, longitude
- width_ft, height_ft, total_sqft (auto-calculated)
- illumination (frontlit | backlit | digital | nonlit)
- facing (N | S | E | W | NE | NW | SE | SW)
- traffic_side (lhs | rhs | both)
- visibility_distance_m
- ownership_model (owned | rented | traded)
- structure_type (permanent | temporary | digital)
- status (available | booked | maintenance | blocked | expired)
- base_monthly_rate (encrypted in Phase 2) — NUMERIC, stored in INR
- municipal_permission_number, municipal_permission_expiry
- notes (text)
- is_marketplace_listed (boolean, default false) — for Phase 2
- marketplace_visibility_settings (jsonb) — for Phase 2
```

#### site_photos
```
- id, site_id, organization_id
- photo_url (Supabase Storage path)
- photo_type (day | night | closeup | longshot | other)
- is_primary (boolean)
- sort_order (integer)
```

#### landowners
```
- id, organization_id
- full_name, phone, email, alternate_phone
- address, city, state, pincode
- pan_number (encrypted), aadhaar_reference (encrypted)
- bank_name, bank_account_number (encrypted), bank_ifsc (encrypted)
- notes
```

#### partner_agencies
```
- id, organization_id
- agency_name, contact_person, phone, email
- gstin, address, city, state
- notes
```

#### contracts
```
- id, organization_id
- contract_type (landowner | agency)
- counterparty_id — UUID of landowner or partner_agency
- site_id — linked site
- payment_model (monthly_fixed | yearly_lumpsum | revenue_share | custom)
- amount (encrypted) — NUMERIC
- revenue_share_percentage — for revenue share model
- minimum_guarantee (encrypted) — for revenue share model
- payment_day_of_month — for monthly (e.g., 5th of every month)
- escalation_percentage — yearly rent increase %
- start_date, end_date, renewal_date, notice_period_days
- lock_period_months
- status (active | expired | terminated | pending_renewal)
- document_urls (text[]) — uploaded contract scans
- terms_notes (text) — custom terms
```

#### clients
```
- id, organization_id
- company_name, brand_name, industry
- primary_contact_name, primary_contact_phone, primary_contact_email
- secondary_contact_name, secondary_contact_phone, secondary_contact_email
- billing_contact_name, billing_contact_email
- gstin, pan, billing_address, city, state, pincode
- credit_terms (advance | net15 | net30 | net60)
- client_type (direct | agency | government)
- notes
```

#### campaigns
```
- id, organization_id, client_id
- campaign_name, campaign_code (auto-generated)
- start_date, end_date
- status (enquiry | proposal_sent | confirmed | creative_received | printing | mounted | live | completed | dismounted | cancelled)
- total_value (encrypted) — NUMERIC
- pricing_model (itemized | bundled)
- notes
```

#### campaign_sites (junction: campaign ↔ sites)
```
- id, campaign_id, site_id, organization_id
- site_rate (encrypted) — NUMERIC, the rate charged to client for this site
- printing_charge, mounting_charge, design_charge, other_charges — all NUMERIC
- start_date, end_date — can differ per site within a campaign
- creative_file_urls (text[])
- mounting_date, mounting_team_notes
- proof_photo_urls (text[]) — post-mounting photos
- status (pending | printing | mounted | live | dismounted)
```

#### invoices
```
- id, organization_id, client_id, campaign_id (nullable)
- invoice_number (auto-generated, configurable format)
- invoice_date, due_date
- subtotal, cgst_amount, sgst_amount, igst_amount, total_amount — all NUMERIC
- gst_rate (default 18)
- status (draft | sent | partially_paid | paid | overdue | cancelled)
- notes, terms_text
- pdf_url — generated invoice PDF path
```

#### invoice_line_items
```
- id, invoice_id, organization_id
- description (e.g., "Display Rental — Site MUM-BKC-001, Apr 2026")
- hsn_sac_code
- quantity, unit_price, amount — NUMERIC
- site_id (nullable, for linking to specific site)
```

#### payments_received
```
- id, organization_id, invoice_id, client_id
- amount — NUMERIC
- payment_date
- payment_mode (cash | cheque | bank_transfer | upi | online)
- reference_number, notes
```

#### payables (what we owe landowners / agencies)
```
- id, organization_id, contract_id
- counterparty_type (landowner | agency)
- counterparty_id
- amount — NUMERIC
- due_date
- status (upcoming | due | paid | overdue)
- payment_date, payment_reference, payment_proof_url
- tds_amount — NUMERIC (for landowner payments)
```

#### alerts
```
- id, organization_id
- alert_type (rent_due | payment_overdue | contract_renewal | campaign_ending | site_available | permission_expiry | mounting_scheduled)
- entity_type, entity_id — polymorphic reference
- trigger_date, is_read, is_dismissed
- assigned_to — UUID of user
- message (text)
- channels (jsonb) — {email: true, whatsapp: false, in_app: true}
```

#### activity_log
```
- id, organization_id
- user_id, action (created | updated | deleted | status_changed | payment_recorded | etc.)
- entity_type, entity_id
- details (jsonb) — what changed
- ip_address
```

### Row Level Security (RLS) — CRITICAL

**EVERY table must have RLS enabled.** The base policy for ALL tables:

```sql
-- Enable RLS
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

-- Base policy: users can only see their organization's data
CREATE POLICY "Users can view own org data" ON <table_name>
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- Insert: auto-set organization_id
CREATE POLICY "Users can insert own org data" ON <table_name>
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- Update: only own org
CREATE POLICY "Users can update own org data" ON <table_name>
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- Delete: only own org (restrict to admin roles)
CREATE POLICY "Admins can delete own org data" ON <table_name>
  FOR DELETE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );
```

**Never bypass RLS.** Always use the regular Supabase client, not the admin/service-role client, unless absolutely necessary (e.g., cron jobs for reminders).

---

## Coding Conventions

### General Rules
- **TypeScript strict mode** — no `any` types. Define proper interfaces/types for everything
- **One component per file** — name file same as component (PascalCase for components, kebab-case for utilities)
- **Use Server Components by default** — only add `"use client"` when you need interactivity (forms, state, effects)
- **Use Server Actions for mutations** — define in separate `actions.ts` files, not inline
- **Error handling** — always wrap Supabase calls in try/catch. Show user-friendly error toasts via sonner
- **Loading states** — use `loading.tsx` files and Suspense boundaries. Never leave users staring at a blank screen
- **Currency** — always store as NUMERIC in database, display with `₹` prefix and Indian number formatting (12,34,567.00)
- **Dates** — store as `timestamptz` in UTC. Display in IST (Asia/Kolkata) using `date-fns` with `format(date, 'dd MMM yyyy')`
- **IDs** — always UUID, never auto-increment integers

### Naming Conventions
- **Database**: snake_case for tables and columns (`campaign_sites`, `start_date`)
- **TypeScript types**: PascalCase (`Site`, `Campaign`, `InvoiceLineItem`)
- **Variables/functions**: camelCase (`getSiteById`, `totalAmount`)
- **Components**: PascalCase (`SiteCard`, `InvoiceTable`)
- **Files**: kebab-case for utils (`format-currency.ts`), PascalCase for components (`SiteCard.tsx`)
- **URL paths**: kebab-case (`/billing/aging-report`)
- **Environment variables**: UPPER_SNAKE_CASE prefixed with `NEXT_PUBLIC_` for client-side

### Component Patterns
```tsx
// Standard page component pattern
export default async function SitesPage() {
  const supabase = createServerClient();
  const { data: sites, error } = await supabase
    .from('sites')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return <ErrorState message="Failed to load sites" />;
  if (!sites?.length) return <EmptyState entity="sites" />;

  return <SiteList sites={sites} />;
}
```

```tsx
// Standard form pattern (client component)
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { siteSchema, type SiteFormValues } from "@/lib/validations";
import { createSite } from "./actions";

export function SiteForm() {
  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: { /* ... */ },
  });

  async function onSubmit(values: SiteFormValues) {
    const result = await createSite(values);
    if (result.error) toast.error(result.error);
    else toast.success("Site created");
  }

  return <Form {...form}>/* shadcn/ui form fields */</Form>;
}
```

### Supabase Query Patterns
```typescript
// ALWAYS select specific columns, not *
const { data, error } = await supabase
  .from('sites')
  .select('id, name, site_code, city, status, media_type, base_monthly_rate')
  .eq('status', 'available')
  .order('city')
  .limit(50);

// For relations, use Supabase joins
const { data } = await supabase
  .from('campaigns')
  .select(`
    *,
    client:clients(company_name, primary_contact_name),
    campaign_sites(
      site:sites(id, name, site_code, city)
    )
  `)
  .eq('status', 'live');

// NEVER do this:
// const { data } = await supabase.from('sites').select('*'); // Too broad
```

---

## Key Business Logic

### Site Status Auto-Updates
- When a campaign with this site moves to `live` → site status = `booked`
- When a campaign with this site moves to `dismounted` or `completed` → check if any other active campaign uses this site. If none → site status = `available`
- When a contract expires → site status = `expired`
- Status can also be manually overridden to `maintenance` or `blocked`

### Invoice Number Format
Default: `INV-{YYYY}-{MM}-{SEQ}` e.g., `INV-2026-04-0001`
Sequential counter resets yearly. Configurable in organization settings.

### GST Calculation
- Default GST rate: 18%
- If client GSTIN state code matches our state code → CGST (9%) + SGST (9%)
- If different state → IGST (18%)
- SAC Code for OOH advertising services: 998361

### Payment Reminders Logic
- Landowner rent: remind 7, 3, 1 days before due date
- Client overdue: remind 1, 7, 15, 30 days after due date
- Contract renewal: remind 90, 60, 30 days before expiry
- All intervals configurable per organization in settings

### Profit Per Site Calculation
```
Revenue = sum of all campaign_sites.site_rate for this site (in date range)
Cost = sum of all payables for the contract linked to this site (in date range)
Profit = Revenue - Cost
Margin = (Profit / Revenue) * 100
Occupancy = (days_booked / total_days) * 100
```

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # Server-side only, NEVER expose to client

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Resend (Email)
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=               # Platform name once decided
```

---

## Build Order (Follow This Sequence)

Build module by module. Do NOT skip ahead. Test each thoroughly before moving on.

### Sprint 1: Foundation (Weeks 1–2)
1. Initialize Next.js project with TypeScript, Tailwind, shadcn/ui
2. Set up Supabase project + create all migration files for the schema above
3. Implement auth (login, signup, forgot password) with Supabase Auth
4. Create `profiles` table trigger to auto-create profile on signup
5. Build sidebar + topbar layout with navigation
6. Implement role-based route protection middleware
7. Create organization settings page

### Sprint 2: Sites & Inventory (Weeks 3–4)
1. Sites CRUD (create, read, update, delete with soft-delete)
2. Site photo upload with drag-and-drop (Supabase Storage)
3. Google Maps integration — map view with markers
4. Site list view with search, filter (by city, type, status), and sort
5. Site detail page with all fields + photo gallery
6. Availability calendar component (show booked vs available periods)

### Sprint 3: Landowners & Agencies (Weeks 5–6)
1. Landowner CRUD with encrypted sensitive fields
2. Partner agency CRUD
3. Contract management — create contracts with flexible payment models
4. Contract document upload
5. Payment schedule auto-generation from contract terms
6. Renewal tracking with countdown display

### Sprint 4: Clients & Campaigns (Weeks 7–8)
1. Client CRUD with all contact and billing fields
2. Campaign creation wizard (select client → select sites → set dates → set pricing)
3. Campaign status workflow (Kanban board view)
4. Campaign detail page with linked sites, creatives, and timeline
5. Campaign-to-site booking logic (auto-update site status)
6. Post-mounting photo upload by operations team

### Sprint 5: Billing & Invoicing (Weeks 9–10)
1. Invoice generation with GST logic (CGST/SGST/IGST)
2. Itemized and bundled invoice support
3. Invoice PDF generation (@react-pdf/renderer)
4. Payment recording against invoices
5. Payables dashboard (landowner + agency payments)
6. Aging report (receivables and payables)

### Sprint 6: Proposals & Exports (Weeks 11–12)
1. Proposal builder — select sites, choose fields to include
2. Customizable proposal templates
3. PDF export of proposals
4. PPTX export of proposals
5. Rate display options (exact / range / hide)
6. Proposal tracking (sent / viewed / accepted)

### Sprint 7: Alerts & Dashboard (Weeks 13–14)
1. Alert engine — background job to check triggers daily
2. In-app notification center
3. Email notifications via Resend
4. Owner dashboard with KPI cards and charts
5. Per-site P&L calculation and display
6. Standard reports with export to CSV/PDF

### Sprint 8: Polish & Deploy (Weeks 15–16)
1. Mobile responsiveness pass on all pages
2. Multi-language setup (English + Hindi)
3. Empty states, error states, loading skeletons for all pages
4. Performance optimization (pagination, lazy loading images)
5. Production deployment to Vercel
6. Final testing on real data

---

## Common Gotchas & Rules

1. **NEVER store sensitive financial data in plain text** — rates, bank details, PAN must be encrypted. Use Supabase Vault or pgcrypto for field-level encryption
2. **ALWAYS use RLS** — no exceptions. Test by logging in as different roles
3. **NEVER use `supabaseAdmin` client in client-side code** — it bypasses RLS
4. **ALWAYS handle loading and error states** — every data fetch needs both
5. **ALWAYS use Indian number formatting** for currency: `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`
6. **ALWAYS store dates in UTC, display in IST** — use `date-fns-tz` for timezone conversion
7. **NEVER delete records permanently** — use soft-delete (`is_deleted` boolean + `deleted_at` timestamp) for all business entities
8. **ALWAYS validate forms on both client (zod) and server (zod in server actions)**
9. **File uploads** — validate file type and size before upload. Max 5MB per photo, 10MB per document
10. **Pagination** — never load more than 50 records at once. Use cursor-based pagination for large lists
11. **Searching** — use Supabase full-text search (`textSearch`) or `ilike` for simple filters. Never load all records and filter client-side
12. **Mobile first** — design for mobile viewport first, then expand for desktop. Most field team usage will be on phones

---

## Phase 2 Architecture Notes (Plan Ahead)

Even in Phase 1, design with these Phase 2 requirements in mind:

1. **`organization_id` on every table** — this becomes the tenant separator in Phase 2
2. **RLS based on `organization_id`** — already tenant-isolated from day 1
3. **Marketplace tables (add later)**: `marketplace_listings`, `enquiries`, `messages`, `agency_storefronts`
4. **Visibility settings stored as JSONB** on `sites` table — controls what's shown on marketplace per site
5. **Encryption keys per organization** — when adding field-level encryption, use per-org keys so one org's data is undecryptable by another
6. **Keep the Supabase schema clean** — use migrations for every schema change, never edit tables manually in the Supabase dashboard in production

---

## When Stuck

- If a Supabase query isn't working, check RLS policies first — 90% of "empty results" bugs are RLS
- If a component isn't rendering, check if it needs `"use client"` directive
- If types are wrong, regenerate from Supabase: `npx supabase gen types typescript --project-id <ref> > lib/types/supabase.ts`
- If deployment fails on Vercel, check that environment variables are set in Vercel dashboard
- If images aren't loading from Supabase Storage, check bucket policies (public vs private)
