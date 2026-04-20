"use server";
// Settings page server actions

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { AlertType } from "@/lib/types/database";

// ─── Upsert a single alert preference ────────────────────────────────────────

export async function upsertAlertPreference(data: {
  alert_type: AlertType;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
  advance_days: number[];
}): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!profile) return { error: "Profile not found" };

  // Upsert — if a preference for this org+user+type exists, update it; else insert
  const { error } = await supabase
    .from("alert_preferences")
    .upsert(
      {
        organization_id: profile.org_id,
        user_id: user.id,
        role: null, // user-level preference takes precedence over role-level
        alert_type: data.alert_type,
        in_app: data.in_app,
        email: data.email,
        whatsapp: data.whatsapp,
        advance_days: data.advance_days,
      },
      { onConflict: "organization_id,user_id,alert_type" }
    );

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

// ─── Update organization info ─────────────────────────────────────────────────

export async function updateOrganization(data: {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pin_code?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!profile) return { error: "Profile not found" };
  if (!["super_admin", "admin"].includes(profile.role)) {
    return { error: "Only admins can update organization settings" };
  }

  const { error } = await supabase
    .from("organizations")
    .update(data)
    .eq("id", profile.org_id);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

// ─── Seed dummy data ──────────────────────────────────────────────────────────
// Admin-only. Populates the current org with realistic, linked dummy data so
// every page has something to render. Uses the service-role client to sidestep
// RLS but always scopes writes to the caller's organization_id.

type SeedCounts = {
  landowners: number;
  partner_agencies: number;
  sites: number;
  contracts: number;
  contract_payments: number;
  clients: number;
  campaigns: number;
  campaign_sites: number;
  invoices: number;
  invoice_line_items: number;
  payments_received: number;
  proposals: number;
  proposal_sites: number;
};

export async function seedDummyData(): Promise<
  { success: true; counts: SeedCounts } | { error: string }
> {
  // ── 1. Auth + role gate (via the normal server client) ────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.org_id) return { error: "Profile / organization not found" };
  if (!["super_admin", "admin"].includes(profile.role)) {
    return { error: "Only admins can seed dummy data" };
  }

  const orgId = profile.org_id as string;
  const userId = user.id;

  // ── 2. Idempotency guard ──────────────────────────────────────────────────
  const admin = createAdminClient();
  const { count: existingSiteCount, error: countErr } = await admin
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  if (countErr) return { error: `Could not check existing data: ${countErr.message}` };
  if ((existingSiteCount ?? 0) > 5) {
    return { error: "Dummy data already present. Clear first or use a fresh org." };
  }

  // ── 3. Helpers ────────────────────────────────────────────────────────────
  // Dates are ISO "yyyy-mm-dd" for DATE columns.
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (base: Date, days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  };
  const addMonths = (base: Date, months: number) => {
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    return d;
  };

  try {
    // ── 4. Landowners (5) ───────────────────────────────────────────────────
    const landownerRows = [
      { full_name: "Ramesh Kulkarni", city: "Mumbai",    state: "Maharashtra", pin: "400051", pan: "ABCPK1234E", bank: "HDFC Bank",    acc: "50100123456789", ifsc: "HDFC0001234" },
      { full_name: "Priya Sharma",    city: "Delhi",     state: "Delhi",       pin: "110001", pan: "AXBPS5678F", bank: "ICICI Bank",   acc: "000101234567",   ifsc: "ICIC0000001" },
      { full_name: "Vinod Rao",       city: "Bangalore", state: "Karnataka",   pin: "560001", pan: "CXRPR9012G", bank: "Axis Bank",    acc: "912010012345678", ifsc: "UTIB0000123" },
      { full_name: "Sunita Deshmukh", city: "Pune",      state: "Maharashtra", pin: "411001", pan: "DEXPD3456H", bank: "SBI",          acc: "20123456789",    ifsc: "SBIN0001234" },
      { full_name: "Arjun Mehta",     city: "Mumbai",    state: "Maharashtra", pin: "400028", pan: "EFGPM7890J", bank: "Kotak Bank",   acc: "7311234567",     ifsc: "KKBK0000123" },
    ].map((r, i) => ({
      organization_id: orgId,
      created_by: userId,
      updated_by: userId,
      deleted_at: null,
      full_name: r.full_name,
      phone: `+9198${(20000000 + i * 111111).toString().slice(0, 8)}`,
      phone_alt: null,
      email: `${r.full_name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      address: `${i + 1}, Sample Lane`,
      city: r.city,
      state: r.state,
      pin_code: r.pin,
      pan_number: r.pan,
      aadhaar_reference: `XXXX-XXXX-${1000 + i * 111}`,
      bank_name: r.bank,
      bank_account_number: r.acc,
      bank_ifsc: r.ifsc,
      notes: null,
    }));

    const { data: landowners, error: loErr } = await admin
      .from("landowners")
      .insert(landownerRows)
      .select("id");
    if (loErr) throw new Error(`landowners: ${loErr.message}`);

    // ── 5. Partner agencies (3) ─────────────────────────────────────────────
    const agencyRows = [
      { agency_name: "Signboard Solutions Pvt Ltd", contact: "Rahul Kapoor",  city: "Mumbai",    state: "Maharashtra", gstin: "27AABCS1234A1Z5" },
      { agency_name: "Metro Media Agencies",        contact: "Neha Iyer",     city: "Delhi",     state: "Delhi",       gstin: "07AABCM5678B1Z9" },
      { agency_name: "Skyline OOH Partners",        contact: "Kiran Joshi",   city: "Bangalore", state: "Karnataka",   gstin: "29AABCS9012C1Z3" },
    ].map((r, i) => ({
      organization_id: orgId,
      created_by: userId,
      updated_by: userId,
      deleted_at: null,
      agency_name: r.agency_name,
      contact_person: r.contact,
      phone: `+9199${(10000000 + i * 222222).toString().slice(0, 8)}`,
      email: `contact@${r.agency_name.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      gstin: r.gstin,
      address: `Office ${i + 1}, Business Park`,
      city: r.city,
      state: r.state,
      notes: null,
    }));

    const { data: agencies, error: agErr } = await admin
      .from("partner_agencies")
      .insert(agencyRows)
      .select("id");
    if (agErr) throw new Error(`partner_agencies: ${agErr.message}`);

    // ── 6. Sites (15) ───────────────────────────────────────────────────────
    const siteSeeds: Array<{
      code: string; name: string; city: string; state: string; pin: string;
      lat: number; lng: number; media: string; illum: string; struct: string;
      status: string; w: number; h: number; rate: number;
    }> = [
      // Mumbai (5)
      { code: "MUM-BKC-001",  name: "BKC Junction Billboard",     city: "Mumbai", state: "Maharashtra", pin: "400051", lat: 19.0674, lng: 72.8688, media: "billboard",   illum: "frontlit", struct: "permanent", status: "booked",      w: 40, h: 20, rate: 25000000 },
      { code: "MUM-AND-002",  name: "Andheri West Hoarding",      city: "Mumbai", state: "Maharashtra", pin: "400058", lat: 19.1364, lng: 72.8296, media: "hoarding",    illum: "backlit",  struct: "permanent", status: "available",   w: 30, h: 20, rate: 18000000 },
      { code: "MUM-BAN-003",  name: "Bandra Linking Road Unipole", city: "Mumbai",state: "Maharashtra", pin: "400050", lat: 19.0596, lng: 72.8295, media: "unipole",     illum: "frontlit", struct: "permanent", status: "booked",      w: 20, h: 40, rate: 22000000 },
      { code: "MUM-POW-004",  name: "Powai Lake DOOH",            city: "Mumbai", state: "Maharashtra", pin: "400076", lat: 19.1176, lng: 72.9060, media: "dooh",        illum: "digital",  struct: "digital",   status: "available",   w: 25, h: 15, rate: 30000000 },
      { code: "MUM-DAD-005",  name: "Dadar Bus Shelter",          city: "Mumbai", state: "Maharashtra", pin: "400014", lat: 19.0176, lng: 72.8562, media: "bus_shelter", illum: "backlit",  struct: "permanent", status: "maintenance", w: 12, h: 8,  rate: 8000000 },

      // Delhi (4)
      { code: "DEL-CP-001",   name: "Connaught Place Billboard",  city: "Delhi", state: "Delhi",       pin: "110001", lat: 28.6315, lng: 77.2167, media: "billboard",   illum: "frontlit", struct: "permanent", status: "booked",      w: 40, h: 20, rate: 28000000 },
      { code: "DEL-SAK-002",  name: "Saket Metro Hoarding",       city: "Delhi", state: "Delhi",       pin: "110017", lat: 28.5245, lng: 77.2066, media: "hoarding",    illum: "backlit",  struct: "permanent", status: "available",   w: 30, h: 20, rate: 17000000 },
      { code: "DEL-GUR-003",  name: "Gurgaon Expressway DOOH",    city: "Delhi", state: "Delhi",       pin: "122001", lat: 28.4595, lng: 77.0266, media: "dooh",        illum: "digital",  struct: "digital",   status: "available",   w: 30, h: 15, rate: 29000000 },
      { code: "DEL-LAJ-004",  name: "Lajpat Nagar Unipole",       city: "Delhi", state: "Delhi",       pin: "110024", lat: 28.5700, lng: 77.2430, media: "unipole",     illum: "frontlit", struct: "permanent", status: "booked",      w: 20, h: 30, rate: 19000000 },

      // Bangalore (3)
      { code: "BLR-MG-001",   name: "MG Road Billboard",          city: "Bangalore", state: "Karnataka", pin: "560001", lat: 12.9759, lng: 77.6063, media: "billboard",   illum: "frontlit", struct: "permanent", status: "available", w: 40, h: 20, rate: 20000000 },
      { code: "BLR-KOR-002",  name: "Koramangala DOOH",           city: "Bangalore", state: "Karnataka", pin: "560034", lat: 12.9352, lng: 77.6245, media: "dooh",        illum: "digital",  struct: "digital",   status: "available", w: 25, h: 15, rate: 24000000 },
      { code: "BLR-WHF-003",  name: "Whitefield Hoarding",        city: "Bangalore", state: "Karnataka", pin: "560066", lat: 12.9698, lng: 77.7500, media: "hoarding",    illum: "backlit",  struct: "permanent", status: "booked",    w: 30, h: 20, rate: 15000000 },

      // Pune (3)
      { code: "PNE-KOR-001",  name: "Koregaon Park Unipole",      city: "Pune", state: "Maharashtra", pin: "411001", lat: 18.5362, lng: 73.8939, media: "unipole",     illum: "frontlit", struct: "permanent", status: "available", w: 20, h: 30, rate: 12000000 },
      { code: "PNE-HIN-002",  name: "Hinjewadi IT Park Billboard",city: "Pune", state: "Maharashtra", pin: "411057", lat: 18.5908, lng: 73.7389, media: "billboard",   illum: "frontlit", struct: "permanent", status: "booked",    w: 40, h: 20, rate: 14000000 },
      { code: "PNE-SHI-003",  name: "Shivajinagar Bus Shelter",   city: "Pune", state: "Maharashtra", pin: "411005", lat: 18.5308, lng: 73.8470, media: "bus_shelter", illum: "backlit",  struct: "permanent", status: "available", w: 12, h: 8,  rate: 5000000 },
    ];

    // First 12 sites are owned (linked to landowners); last 3 are rented
    // from partner agencies (linked via contracts, no landowner_id).
    const siteRows = siteSeeds.map((s, i) => {
      const isOwned = i < 12;
      return {
        organization_id: orgId,
        created_by: userId,
        updated_by: userId,
        deleted_at: null,
        site_code: s.code,
        name: s.name,
        media_type: s.media,
        structure_type: s.struct,
        status: s.status,
        address: `${s.name}, ${s.city}`,
        city: s.city,
        state: s.state,
        pincode: s.pin,
        landmark: null,
        latitude: s.lat,
        longitude: s.lng,
        width_ft: s.w,
        height_ft: s.h,
        illumination: s.illum,
        facing: "N",
        traffic_side: "both",
        visibility_distance_m: 150,
        ownership_model: isOwned ? "owned" : "rented",
        landowner_id: isOwned ? landowners![i % landowners!.length].id : null,
        base_rate_paise: s.rate,
        municipal_permission_number: `MCP/${s.code}/2025`,
        municipal_permission_expiry: iso(addMonths(today, 12)),
        notes: null,
        is_marketplace_listed: false,
        marketplace_visibility_settings: {},
      };
    });

    const { data: sites, error: siteErr } = await admin
      .from("sites")
      .insert(siteRows)
      .select("id, base_rate_paise, site_code, city, name");
    if (siteErr) throw new Error(`sites: ${siteErr.message}`);
    if (!sites || sites.length !== 15) throw new Error("sites: unexpected insert count");

    // ── 7. Contracts — one per site (12 landowner + 3 agency) ───────────────
    const startDate = addMonths(today, -6);
    const endDate = addMonths(today, 6);

    const contractRows = sites.map((s, i) => {
      const isAgency = i >= 12;
      // rent = 60% of base rate (our cost)
      const rent = Math.round((s.base_rate_paise ?? 10000000) * 0.6);
      return {
        organization_id: orgId,
        created_by: userId,
        updated_by: userId,
        deleted_at: null,
        contract_type: isAgency ? "agency" : "landowner",
        landowner_id: isAgency ? null : landowners![i % landowners!.length].id,
        agency_id:    isAgency ? agencies![(i - 12) % agencies!.length].id : null,
        site_id: s.id,
        payment_model: "monthly_fixed",
        rent_amount_paise: rent,
        payment_day_of_month: 5,
        payment_date: null,
        revenue_share_percentage: null,
        minimum_guarantee_paise: null,
        escalation_percentage: 10,
        escalation_frequency_months: 12,
        start_date: iso(startDate),
        end_date: iso(endDate),
        renewal_date: iso(addMonths(endDate, -2)),
        notice_period_days: 90,
        lock_period_months: 6,
        early_termination_clause: null,
        status: "active",
        contract_document_url: null,
        notes: null,
      };
    });

    const { data: contracts, error: cErr } = await admin
      .from("contracts")
      .insert(contractRows)
      .select("id, contract_type, rent_amount_paise");
    if (cErr) throw new Error(`contracts: ${cErr.message}`);

    // ── 8. Contract payments — 6 monthly per landowner contract ─────────────
    const landownerContracts = (contracts ?? []).filter((c) => c.contract_type === "landowner");
    const contractPaymentRows: Array<Record<string, unknown>> = [];
    for (const c of landownerContracts) {
      for (let m = 0; m < 6; m++) {
        const due = addMonths(startDate, m);
        due.setDate(5);
        const isPaid = m < 4;
        const amountDue = c.rent_amount_paise ?? 0;
        const tds = Math.round(amountDue * 0.1);
        contractPaymentRows.push({
          organization_id: orgId,
          created_by: userId,
          updated_by: userId,
          contract_id: c.id,
          due_date: iso(due),
          amount_due_paise: amountDue,
          amount_paid_paise: isPaid ? amountDue : null,
          payment_date: isPaid ? iso(addDays(due, 1)) : null,
          payment_mode: isPaid ? "bank_transfer" : null,
          payment_reference: isPaid ? `TXN${Date.now() % 1_000_000}${m}` : null,
          tds_deducted_paise: isPaid ? tds : null,
          tds_percentage: 10,
          status: isPaid ? "paid" : "upcoming",
          notes: null,
        });
      }
    }
    const { error: cpErr } = await admin
      .from("contract_payments")
      .insert(contractPaymentRows);
    if (cpErr) throw new Error(`contract_payments: ${cpErr.message}`);

    // ── 9. Clients (8) ──────────────────────────────────────────────────────
    const clientSeeds = [
      { company: "Tata Motors Ltd",          brand: "Tata Nexon",    industry: "Automotive",  type: "direct_client", gstin: "27AAACT2727Q1ZV", state: "Maharashtra", pin: "400001", credit: "net30" },
      { company: "HDFC Bank Ltd",            brand: "HDFC",          industry: "Banking",     type: "direct_client", gstin: "27AAACH2702H1ZU", state: "Maharashtra", pin: "400013", credit: "net30" },
      { company: "Reliance Retail",          brand: "Smart Bazaar",  industry: "Retail",      type: "direct_client", gstin: "27AAACR5055K1ZU", state: "Maharashtra", pin: "400710", credit: "net15" },
      { company: "Zomato Ltd",               brand: "Zomato",        industry: "F&B Tech",    type: "direct_client", gstin: "07AAACZ1234M1Z1", state: "Delhi",       pin: "110017", credit: "net30" },
      { company: "Ogilvy India Pvt Ltd",     brand: "Ogilvy",        industry: "Advertising", type: "agency",        gstin: "27AAACO4321L1Z6", state: "Maharashtra", pin: "400051", credit: "net60" },
      { company: "Flipkart Internet Pvt Ltd",brand: "Flipkart",      industry: "E-commerce",  type: "direct_client", gstin: "29AAACF0001B1Z2", state: "Karnataka",   pin: "560034", credit: "net30" },
      { company: "BMC Dept of Info",         brand: "BMC",           industry: "Government",  type: "government",    gstin: "27BMCGO0001A1Z0", state: "Maharashtra", pin: "400001", credit: "advance" },
      { company: "Asian Paints Ltd",         brand: "Asian Paints",  industry: "Consumer",    type: "direct_client", gstin: "27AAACA6666P1Z9", state: "Maharashtra", pin: "400030", credit: "net15" },
    ];
    const clientRows = clientSeeds.map((c) => ({
      organization_id: orgId,
      created_by: userId,
      updated_by: userId,
      deleted_at: null,
      company_name: c.company,
      brand_name: c.brand,
      industry_category: c.industry,
      client_type: c.type,
      primary_contact_name: `${c.brand} Marketing Head`,
      primary_contact_phone: "+919812345678",
      primary_contact_email: `marketing@${c.brand.toLowerCase().replace(/\s+/g, "")}.com`,
      secondary_contact_name: null,
      secondary_contact_phone: null,
      secondary_contact_email: null,
      billing_contact_name: `${c.brand} Accounts`,
      billing_contact_phone: "+919898989898",
      billing_contact_email: `accounts@${c.brand.toLowerCase().replace(/\s+/g, "")}.com`,
      gstin: c.gstin,
      pan: c.gstin.slice(2, 12),
      billing_address: `${c.company} HO`,
      billing_city: c.state === "Maharashtra" ? "Mumbai" : c.state === "Delhi" ? "Delhi" : "Bangalore",
      billing_state: c.state,
      billing_pin_code: c.pin,
      credit_terms: c.credit,
      notes: null,
    }));

    const { data: clients, error: clErr } = await admin
      .from("clients")
      .insert(clientRows)
      .select("id, company_name, gstin, billing_state");
    if (clErr) throw new Error(`clients: ${clErr.message}`);

    // ── 10. Campaigns (8) ───────────────────────────────────────────────────
    // Index of site usage so we don't double-book a site per campaign.
    // Statuses: 2 live, 2 completed, 1 confirmed, 1 printing, 1 mounted, 1 enquiry
    const campaignPlan: Array<{
      name: string; status: string; clientIdx: number;
      siteIdxs: number[]; startOffsetMonths: number; durationMonths: number;
    }> = [
      { name: "Tata Nexon Q1 Launch",     status: "live",      clientIdx: 0, siteIdxs: [0, 2, 5],        startOffsetMonths: -1, durationMonths: 2 },
      { name: "HDFC Home Loans",          status: "live",      clientIdx: 1, siteIdxs: [8, 11],          startOffsetMonths: -1, durationMonths: 2 },
      { name: "Smart Bazaar Sale",        status: "completed", clientIdx: 2, siteIdxs: [1, 9],           startOffsetMonths: -4, durationMonths: 2 },
      { name: "Zomato Late Night",        status: "completed", clientIdx: 3, siteIdxs: [6, 12],          startOffsetMonths: -5, durationMonths: 1 },
      { name: "Ogilvy Client Booking",    status: "confirmed", clientIdx: 4, siteIdxs: [4, 7, 10, 13],   startOffsetMonths: 1,  durationMonths: 3 },
      { name: "Flipkart Big Billion Day", status: "printing",  clientIdx: 5, siteIdxs: [3, 14],          startOffsetMonths: 1,  durationMonths: 2 },
      { name: "Asian Paints Festive",     status: "mounted",   clientIdx: 7, siteIdxs: [0, 8],           startOffsetMonths: 0,  durationMonths: 2 },
      { name: "BMC Civic Awareness",      status: "enquiry",   clientIdx: 6, siteIdxs: [2, 11, 13],      startOffsetMonths: 2,  durationMonths: 1 },
    ];

    const campaignRows = campaignPlan.map((p) => {
      const cStart = addMonths(today, p.startOffsetMonths);
      const cEnd = addMonths(cStart, p.durationMonths);
      // total = sum of site base rates * months
      const total = p.siteIdxs.reduce(
        (sum, si) => sum + (sites![si].base_rate_paise ?? 0) * p.durationMonths,
        0
      );
      return {
        organization_id: orgId,
        created_by: userId,
        updated_by: userId,
        deleted_at: null,
        client_id: clients![p.clientIdx].id,
        campaign_name: p.name,
        start_date: iso(cStart),
        end_date: iso(cEnd),
        status: p.status,
        total_value_paise: total,
        pricing_type: "itemized",
        notes: null,
      };
    });

    const { data: campaigns, error: cmpErr } = await admin
      .from("campaigns")
      .insert(campaignRows)
      .select("id, campaign_name, start_date, end_date, status, total_value_paise, client_id");
    if (cmpErr) throw new Error(`campaigns: ${cmpErr.message}`);

    // ── 11. Campaign sites ──────────────────────────────────────────────────
    const campaignSiteRows: Array<Record<string, unknown>> = [];
    campaignPlan.forEach((plan, i) => {
      const camp = campaigns![i];
      plan.siteIdxs.forEach((si) => {
        const site = sites![si];
        let csStatus: string;
        let mountingDate: string | null = null;
        if (plan.status === "live") { csStatus = "live"; mountingDate = iso(addDays(new Date(camp.start_date as string), 2)); }
        else if (plan.status === "completed") { csStatus = "dismounted"; mountingDate = iso(addDays(new Date(camp.start_date as string), 2)); }
        else if (plan.status === "mounted") { csStatus = "mounted"; mountingDate = iso(addDays(today, -2)); }
        else if (plan.status === "printing") { csStatus = "printing"; }
        else if (plan.status === "confirmed") { csStatus = "pending"; }
        else { csStatus = "pending"; }

        campaignSiteRows.push({
          organization_id: orgId,
          campaign_id: camp.id,
          site_id: site.id,
          display_rate_paise: site.base_rate_paise,
          start_date: camp.start_date,
          end_date: camp.end_date,
          creative_file_url: null,
          creative_size_width: null,
          creative_size_height: null,
          mounting_date: mountingDate,
          dismounting_date: plan.status === "completed" ? camp.end_date : null,
          mounting_photo_url: null,
          status: csStatus,
          notes: null,
        });
      });
    });

    const { error: csErr } = await admin
      .from("campaign_sites")
      .insert(campaignSiteRows);
    if (csErr) throw new Error(`campaign_sites: ${csErr.message}`);

    // ── 12. Invoices for live + completed campaigns ─────────────────────────
    // Desired invoice status mix: 3 paid, 2 partially_paid, 2 sent, 1 overdue.
    // We'll generate one invoice per live/completed/mounted/printing campaign (7 total).
    const billableCampaigns = campaigns!.filter(() => true).slice(0, 8);
    const invoiceStatusPlan: string[] = ["paid", "paid", "paid", "partially_paid", "partially_paid", "sent", "sent", "overdue"];

    const ourGstin = "27OOHAG0001A1Z5"; // Maharashtra-based supplier
    const ourState = "Maharashtra";

    const invoiceInsertPayloads = billableCampaigns.map((camp, i) => {
      const client = clients!.find((cl) => cl.id === camp.client_id)!;
      const subtotal = camp.total_value_paise ?? 10000000;
      const isInterState = client.billing_state !== ourState;
      const cgst = isInterState ? 0 : Math.round(subtotal * 0.09);
      const sgst = isInterState ? 0 : Math.round(subtotal * 0.09);
      const igst = isInterState ? Math.round(subtotal * 0.18) : 0;
      const total = subtotal + cgst + sgst + igst;
      const status = invoiceStatusPlan[i] ?? "sent";
      const amountPaid =
        status === "paid" ? total :
        status === "partially_paid" ? Math.round(total * 0.4) :
        0;
      const invoiceDate = status === "overdue" ? addDays(today, -45) : addDays(today, -10 - i);
      const dueDate = addDays(invoiceDate, 30);
      return {
        organization_id: orgId,
        created_by: userId,
        updated_by: userId,
        deleted_at: null,
        client_id: camp.client_id,
        campaign_id: camp.id,
        invoice_date: iso(invoiceDate),
        due_date: iso(dueDate),
        subtotal_paise: subtotal,
        cgst_paise: cgst,
        sgst_paise: sgst,
        igst_paise: igst,
        total_paise: total,
        amount_paid_paise: amountPaid,
        balance_due_paise: total - amountPaid,
        supplier_gstin: ourGstin,
        buyer_gstin: client.gstin,
        place_of_supply_state: client.billing_state,
        is_inter_state: isInterState,
        sac_code: "998361",
        status,
        notes: null,
        terms_and_conditions: "Payment due within 30 days of invoice date.",
        pdf_url: null,
      };
    });

    // Insert invoices one-by-one so the invoice_number trigger computes unique sequences.
    const insertedInvoices: Array<{ id: string; client_id: string; campaign_id: string | null; status: string; total_paise: number; amount_paid_paise: number; invoice_date: string }>= [];
    for (const payload of invoiceInsertPayloads) {
      const { data, error } = await admin
        .from("invoices")
        .insert(payload)
        .select("id, client_id, campaign_id, status, total_paise, amount_paid_paise, invoice_date")
        .single();
      if (error) throw new Error(`invoices: ${error.message}`);
      insertedInvoices.push(data as typeof insertedInvoices[number]);
    }

    // ── 13. Invoice line items — 2-3 per invoice ────────────────────────────
    const lineItemRows: Array<Record<string, unknown>> = [];
    insertedInvoices.forEach((inv) => {
      const camp = campaigns!.find((c) => c.id === inv.campaign_id);
      if (!camp) return;
      const planIdx = campaigns!.findIndex((c) => c.id === camp.id);
      const plan = campaignPlan[planIdx];
      // Pick 2-3 sites from the plan
      const pickCount = Math.min(3, plan.siteIdxs.length);
      for (let k = 0; k < pickCount; k++) {
        const siteIdx = plan.siteIdxs[k];
        const site = sites![siteIdx];
        const rate = site.base_rate_paise ?? 0;
        lineItemRows.push({
          organization_id: orgId,
          invoice_id: inv.id,
          site_id: site.id,
          service_type: "display_rental",
          description: `Display Rental — ${site.name} (${site.site_code})`,
          hsn_sac_code: "998361",
          quantity: plan.durationMonths,
          rate_paise: rate,
          amount_paise: rate * plan.durationMonths,
          period_from: camp.start_date,
          period_to: camp.end_date,
        });
      }
    });
    const { error: liErr } = await admin
      .from("invoice_line_items")
      .insert(lineItemRows);
    if (liErr) throw new Error(`invoice_line_items: ${liErr.message}`);

    // ── 14. Payments received ───────────────────────────────────────────────
    const paymentsRows = insertedInvoices
      .filter((inv) => inv.amount_paid_paise > 0)
      .map((inv, i) => ({
        organization_id: orgId,
        created_by: userId,
        invoice_id: inv.id,
        client_id: inv.client_id,
        amount_paise: inv.amount_paid_paise,
        payment_date: iso(addDays(new Date(inv.invoice_date), 5)),
        payment_mode: "bank_transfer",
        reference_number: `NEFT${100000 + i}`,
        bank_name: "HDFC Bank",
        notes: null,
        receipt_number: `RCPT-${2026}-${String(i + 1).padStart(4, "0")}`,
      }));

    if (paymentsRows.length > 0) {
      const { error: prErr } = await admin.from("payments_received").insert(paymentsRows);
      if (prErr) throw new Error(`payments_received: ${prErr.message}`);
    }

    // ── 15. Proposals (4) + proposal_sites ──────────────────────────────────
    const proposalPlan: Array<{ name: string; status: string; clientIdx: number; siteCount: number }> = [
      { name: "Mumbai Premium Billboards — Q2 Pitch",  status: "draft",    clientIdx: 0, siteCount: 5 },
      { name: "Delhi NCR DOOH Package",                status: "draft",    clientIdx: 1, siteCount: 4 },
      { name: "Bangalore Tech Corridor Proposal",      status: "sent",     clientIdx: 5, siteCount: 3 },
      { name: "Pan-India Retail Rollout",              status: "accepted", clientIdx: 2, siteCount: 6 },
    ];

    const proposalRows = proposalPlan.map((p) => ({
      organization_id: orgId,
      created_by: userId,
      updated_by: userId,
      deleted_at: null,
      proposal_name: p.name,
      client_id: clients![p.clientIdx].id,
      template_type: "grid",
      show_rates: "exact",
      show_photos: true,
      show_map: true,
      show_dimensions: true,
      show_illumination: true,
      show_traffic_info: true,
      show_availability: true,
      include_company_branding: true,
      include_terms: true,
      terms_text: "Rates valid for 30 days from proposal date. GST extra as applicable.",
      include_contact_details: true,
      custom_header_text: null,
      custom_footer_text: null,
      status: p.status,
      sent_to_email: p.status !== "draft" ? `client@${clients![p.clientIdx].company_name.toLowerCase().replace(/[^a-z]/g, "")}.com` : null,
      sent_at: p.status !== "draft" ? addDays(today, -7).toISOString() : null,
      viewed_at: p.status === "accepted" ? addDays(today, -5).toISOString() : null,
      pdf_url: null,
      pptx_url: null,
      notes: null,
    }));

    const { data: proposals, error: pErr } = await admin
      .from("proposals")
      .insert(proposalRows)
      .select("id");
    if (pErr) throw new Error(`proposals: ${pErr.message}`);

    const proposalSiteRows: Array<Record<string, unknown>> = [];
    proposalPlan.forEach((p, pi) => {
      for (let k = 0; k < p.siteCount; k++) {
        const site = sites![(pi * 3 + k) % sites!.length];
        proposalSiteRows.push({
          organization_id: orgId,
          proposal_id: proposals![pi].id,
          site_id: site.id,
          custom_rate_paise: site.base_rate_paise,
          custom_notes: null,
          display_order: k,
        });
      }
    });

    const { error: psErr } = await admin
      .from("proposal_sites")
      .insert(proposalSiteRows);
    if (psErr) throw new Error(`proposal_sites: ${psErr.message}`);

    // ── 16. Revalidate relevant paths ───────────────────────────────────────
    revalidatePath("/", "layout");

    const counts: SeedCounts = {
      landowners: landowners!.length,
      partner_agencies: agencies!.length,
      sites: sites!.length,
      contracts: contracts!.length,
      contract_payments: contractPaymentRows.length,
      clients: clients!.length,
      campaigns: campaigns!.length,
      campaign_sites: campaignSiteRows.length,
      invoices: insertedInvoices.length,
      invoice_line_items: lineItemRows.length,
      payments_received: paymentsRows.length,
      proposals: proposals!.length,
      proposal_sites: proposalSiteRows.length,
    };
    return { success: true, counts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { error: `Seed failed: ${msg}` };
  }
}

// ─── Update user profile ──────────────────────────────────────────────────────

export async function updateProfile(data: {
  full_name?: string;
  phone?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}
