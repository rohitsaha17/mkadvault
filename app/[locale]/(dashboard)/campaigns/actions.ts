"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createCampaignSchema, campaignBasicsSchema, campaignSiteEntrySchema,
  draftCampaignSchema, changeRequestSchema, reviewChangeRequestSchema,
} from "@/lib/validations/campaign";
import type { CampaignStatus } from "@/lib/types/database";

type ActionResult = { error: string } | { success: true; id: string };

async function getOrgAndUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("org_id").eq("id", user.id).single();
  if (!profile?.org_id) return null;
  return { supabase, user, orgId: profile.org_id };
}

function n(v: number | undefined | null) { return v != null ? Math.round(v * 100) : null; }
function str(v?: string) { return v?.trim() || null; }

// ─── Create campaign (with optional sites + services) ─────────────────────────

export async function createCampaign(values: unknown): Promise<ActionResult> {
  const parsed = createCampaignSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;

  // Insert campaign
  //
  // billing_party_type drives who gets invoiced:
  //   - 'client'                    → invoice the client
  //   - 'agency'                    → invoice the agency; client_id kept as reference only
  //   - 'client_on_behalf_of_agency' → invoice the client + log commission owed to agency
  const { data: campaign, error: campError } = await ctx.supabase
    .from("campaigns")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
      campaign_name: d.campaign_name,
      client_id: d.client_id && d.client_id !== "" ? d.client_id : null,
      billing_party_type: d.billing_party_type,
      billed_agency_id:
        d.billed_agency_id && d.billed_agency_id !== ""
          ? d.billed_agency_id
          : null,
      agency_commission_percentage:
        d.billing_party_type === "client_on_behalf_of_agency"
          ? d.agency_commission_percentage ?? null
          : null,
      agency_commission_paise:
        d.billing_party_type === "client_on_behalf_of_agency"
          ? n(d.agency_commission_inr)
          : null,
      start_date: str(d.start_date),
      end_date: str(d.end_date),
      status: "enquiry" as CampaignStatus,
      pricing_type: d.pricing_type,
      total_value_paise: n(d.total_value_inr),
      notes: str(d.notes),
    })
    .select("id")
    .single();

  if (campError || !campaign) return { error: campError?.message ?? "Failed to create campaign" };

  const campaignId = campaign.id;

  // Insert campaign_sites
  if (d.sites.length > 0) {
    const siteRows = d.sites.map((s) => ({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      site_id: s.site_id,
      rate_type: s.rate_type ?? "fixed",
      display_rate_paise: n(s.display_rate_inr),
      start_date: str(s.start_date),
      end_date: str(s.end_date),
      status: "pending" as const,
    }));
    const { error: sitesError } = await ctx.supabase.from("campaign_sites").insert(siteRows);
    if (sitesError) return { error: sitesError.message };
  }

  // Insert campaign_services
  if (d.services.length > 0) {
    // For per_sqft services, we need site sqft to calculate the correct total
    const perSqftSiteIds = d.services
      .filter((s) => s.rate_basis === "per_sqft" && s.site_id)
      .map((s) => s.site_id as string);

    // Fetch sqft for linked sites (only if needed)
    let siteSquareFeet: Record<string, number> = {};
    if (perSqftSiteIds.length > 0) {
      const { data: sqftData } = await ctx.supabase
        .from("sites")
        .select("id, total_sqft")
        .in("id", perSqftSiteIds);
      siteSquareFeet = Object.fromEntries(
        (sqftData ?? []).map((s) => [s.id, s.total_sqft ?? 0])
      );
    }

    const serviceRows = d.services.map((s) => {
      const ratePaise = Math.round(s.rate_inr * 100);
      // For per_sqft: total = rate × sqft × quantity
      // For lumpsum/other: total = rate × quantity
      let totalPaise: number;
      if (s.rate_basis === "per_sqft" && s.site_id) {
        const sqft = siteSquareFeet[s.site_id] ?? 1;
        totalPaise = Math.round(s.rate_inr * sqft * s.quantity * 100);
      } else {
        totalPaise = Math.round(s.rate_inr * s.quantity * 100);
      }

      return {
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        site_id: s.site_id ?? null,
        service_type: s.service_type,
        description: str(s.description),
        quantity: s.quantity,
        rate_paise: ratePaise,
        total_paise: totalPaise,
        rate_basis: s.rate_basis ?? "lumpsum",
        other_label: str(s.other_label),
      };
    });
    const { error: servicesError } = await ctx.supabase.from("campaign_services").insert(serviceRows);
    if (servicesError) return { error: servicesError.message };
  }

  // Log activity
  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "created",
    description: `Campaign "${d.campaign_name}" created`,
  });

  revalidatePath("/campaigns");
  return { success: true, id: campaignId };
}

// ─── Update campaign basics ───────────────────────────────────────────────────

export async function updateCampaign(id: string, values: unknown): Promise<ActionResult> {
  const parsed = campaignBasicsSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const { error } = await ctx.supabase
    .from("campaigns")
    .update({
      updated_by: ctx.user.id,
      campaign_name: d.campaign_name,
      client_id: d.client_id && d.client_id !== "" ? d.client_id : null,
      billing_party_type: d.billing_party_type,
      billed_agency_id:
        d.billed_agency_id && d.billed_agency_id !== ""
          ? d.billed_agency_id
          : null,
      agency_commission_percentage:
        d.billing_party_type === "client_on_behalf_of_agency"
          ? d.agency_commission_percentage ?? null
          : null,
      agency_commission_paise:
        d.billing_party_type === "client_on_behalf_of_agency"
          ? n(d.agency_commission_inr)
          : null,
      start_date: str(d.start_date),
      end_date: str(d.end_date),
      pricing_type: d.pricing_type,
      total_value_paise: n(d.total_value_inr),
      notes: str(d.notes),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: id,
    user_id: ctx.user.id,
    action: "updated",
    description: `Campaign details updated`,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return { success: true, id };
}

// ─── Update campaign status (with site status side effects) ───────────────────

export async function updateCampaignStatus(
  campaignId: string,
  newStatus: CampaignStatus
): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  // Fetch current status
  const { data: current } = await ctx.supabase
    .from("campaigns")
    .select("status, campaign_name")
    .eq("id", campaignId)
    .single();

  if (!current) return { error: "Campaign not found" };

  const { error } = await ctx.supabase
    .from("campaigns")
    .update({ status: newStatus, updated_by: ctx.user.id })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  // Fetch all sites in this campaign
  const { data: campSites } = await ctx.supabase
    .from("campaign_sites")
    .select("site_id")
    .eq("campaign_id", campaignId);

  const siteIds = (campSites ?? []).map((cs) => cs.site_id as string);

  if (siteIds.length > 0) {
    // When campaign goes live → mark all sites as booked
    if (newStatus === "live") {
      await ctx.supabase
        .from("sites")
        .update({ status: "booked" })
        .in("id", siteIds);
    }

    // When campaign ends → check if site is used by another active campaign
    if (newStatus === "completed" || newStatus === "dismounted") {
      const activeStatuses: CampaignStatus[] = [
        "confirmed", "creative_received", "printing", "mounted", "live",
      ];

      // Step 1: fetch IDs of other active campaigns
      const { data: activeCampaigns } = await ctx.supabase
        .from("campaigns")
        .select("id")
        .in("status", activeStatuses)
        .is("deleted_at", null)
        .neq("id", campaignId);

      const activeCampaignIds = (activeCampaigns ?? []).map((c) => c.id as string);

      for (const siteId of siteIds) {
        if (activeCampaignIds.length > 0) {
          const { count } = await ctx.supabase
            .from("campaign_sites")
            .select("id", { count: "exact", head: true })
            .eq("site_id", siteId)
            .in("campaign_id", activeCampaignIds);

          // If another active campaign uses this site, skip
          if ((count ?? 0) > 0) continue;
        }

        // No other active campaign uses this site — make it available
        await ctx.supabase
          .from("sites")
          .update({ status: "available" })
          .eq("id", siteId);
      }
    }
  }

  // Log activity
  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "status_changed",
    description: `Status changed to "${newStatus}"`,
    old_value: current.status,
    new_value: newStatus,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Add site to campaign ─────────────────────────────────────────────────────

export async function addCampaignSite(campaignId: string, values: unknown): Promise<{ error?: string }> {
  const parsed = campaignSiteEntrySchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;
  const { error } = await ctx.supabase
    .from("campaign_sites")
    .insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      site_id: d.site_id,
      display_rate_paise: n(d.display_rate_inr),
      start_date: str(d.start_date),
      end_date: str(d.end_date),
      status: "pending",
    });

  if (error) return { error: error.message };

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "site_added",
    description: "Site added to campaign",
    new_value: d.site_id,
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Remove site from campaign ────────────────────────────────────────────────

export async function removeCampaignSite(
  campaignSiteId: string,
  campaignId: string
): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const { error } = await ctx.supabase
    .from("campaign_sites")
    .delete()
    .eq("id", campaignSiteId);

  if (error) return { error: error.message };

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "site_removed",
    description: "Site removed from campaign",
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Cancel campaign (available at any stage) ───────────────────────────────

export async function cancelCampaign(campaignId: string): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const { data: current } = await ctx.supabase
    .from("campaigns")
    .select("status, campaign_name")
    .eq("id", campaignId)
    .single();

  if (!current) return { error: "Campaign not found" };
  if (current.status === "cancelled") return { error: "Already cancelled" };

  const { error } = await ctx.supabase
    .from("campaigns")
    .update({ status: "cancelled", updated_by: ctx.user.id })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  // Release booked sites
  const { data: campSites } = await ctx.supabase
    .from("campaign_sites")
    .select("site_id")
    .eq("campaign_id", campaignId);

  const activeStatuses: CampaignStatus[] = [
    "confirmed", "creative_received", "printing", "mounted", "live",
  ];

  // Fetch IDs of other active campaigns
  const { data: activeCampaigns } = await ctx.supabase
    .from("campaigns")
    .select("id")
    .in("status", activeStatuses)
    .is("deleted_at", null)
    .neq("id", campaignId);

  const activeCampaignIds = (activeCampaigns ?? []).map((c) => c.id as string);

  for (const cs of campSites ?? []) {
    if (activeCampaignIds.length > 0) {
      const { count } = await ctx.supabase
        .from("campaign_sites")
        .select("id", { count: "exact", head: true })
        .eq("site_id", cs.site_id)
        .in("campaign_id", activeCampaignIds);
      if ((count ?? 0) > 0) continue;
    }
    await ctx.supabase.from("sites").update({ status: "available" }).eq("id", cs.site_id);
  }

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "status_changed",
    description: `Campaign cancelled (was "${current.status}")`,
    old_value: current.status,
    new_value: "cancelled",
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Revert proposal_sent → enquiry (reject / make changes) ────────────────

export async function revertToEnquiry(campaignId: string): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const { data: current } = await ctx.supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();

  if (!current) return { error: "Campaign not found" };
  if (current.status !== "proposal_sent") {
    return { error: "Can only revert from Proposal Sent stage" };
  }

  const { error } = await ctx.supabase
    .from("campaigns")
    .update({ status: "enquiry", updated_by: ctx.user.id })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "status_changed",
    description: "Proposal rejected — reverted to Enquiry for changes",
    old_value: "proposal_sent",
    new_value: "enquiry",
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Extend campaign dates ──────────────────────────────────────────────────

export async function extendCampaign(
  campaignId: string,
  newEndDate: string
): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const { data: current } = await ctx.supabase
    .from("campaigns")
    .select("end_date")
    .eq("id", campaignId)
    .single();

  if (!current) return { error: "Campaign not found" };

  const { error } = await ctx.supabase
    .from("campaigns")
    .update({ end_date: newEndDate, updated_by: ctx.user.id })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  // Also update all campaign_sites end dates if they matched the old end date
  if (current.end_date) {
    await ctx.supabase
      .from("campaign_sites")
      .update({ end_date: newEndDate })
      .eq("campaign_id", campaignId)
      .eq("end_date", current.end_date);
  }

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "updated",
    description: `Campaign extended to ${newEndDate}`,
    old_value: current.end_date,
    new_value: newEndDate,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Save campaign as draft (lenient validation) ────────────────────────────

export async function saveCampaignDraft(values: unknown): Promise<ActionResult> {
  const parsed = draftCampaignSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const d = parsed.data;

  const { data: campaign, error: campError } = await ctx.supabase
    .from("campaigns")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
      campaign_name: d.campaign_name,
      client_id: d.client_id && d.client_id !== "" ? d.client_id : null,
      billing_party_type: d.billing_party_type ?? "client",
      billed_agency_id:
        d.billed_agency_id && d.billed_agency_id !== ""
          ? d.billed_agency_id
          : null,
      agency_commission_percentage:
        d.billing_party_type === "client_on_behalf_of_agency"
          ? d.agency_commission_percentage ?? null
          : null,
      agency_commission_paise:
        d.billing_party_type === "client_on_behalf_of_agency"
          ? n(d.agency_commission_inr)
          : null,
      start_date: str(d.start_date),
      end_date: str(d.end_date),
      status: "enquiry" as CampaignStatus,
      pricing_type: d.pricing_type ?? "itemized",
      total_value_paise: n(d.total_value_inr),
      notes: str(d.notes),
    })
    .select("id")
    .single();

  if (campError || !campaign) return { error: campError?.message ?? "Failed to save draft" };

  const campaignId = campaign.id;

  // Insert any sites added so far
  if (d.sites && d.sites.length > 0) {
    const siteRows = d.sites.map((s) => ({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      site_id: s.site_id,
      rate_type: s.rate_type ?? "fixed",
      display_rate_paise: n(s.display_rate_inr),
      start_date: str(s.start_date),
      end_date: str(s.end_date),
      status: "pending" as const,
    }));
    await ctx.supabase.from("campaign_sites").insert(siteRows);
  }

  // Insert any services added so far
  if (d.services && d.services.length > 0) {
    // For per_sqft services, fetch site sqft to calculate correct total
    const perSqftSiteIds = d.services
      .filter((s) => s.rate_basis === "per_sqft" && s.site_id)
      .map((s) => s.site_id as string);

    let siteSquareFeet: Record<string, number> = {};
    if (perSqftSiteIds.length > 0) {
      const { data: sqftData } = await ctx.supabase
        .from("sites")
        .select("id, total_sqft")
        .in("id", perSqftSiteIds);
      siteSquareFeet = Object.fromEntries(
        (sqftData ?? []).map((s) => [s.id, s.total_sqft ?? 0])
      );
    }

    const serviceRows = d.services.map((s) => {
      let totalPaise: number;
      if (s.rate_basis === "per_sqft" && s.site_id) {
        const sqft = siteSquareFeet[s.site_id] ?? 1;
        totalPaise = Math.round(s.rate_inr * sqft * s.quantity * 100);
      } else {
        totalPaise = Math.round(s.rate_inr * s.quantity * 100);
      }

      return {
        organization_id: ctx.orgId,
        campaign_id: campaignId,
        site_id: s.site_id ?? null,
        service_type: s.service_type,
        description: str(s.description),
        quantity: s.quantity,
        rate_paise: Math.round(s.rate_inr * 100),
        total_paise: totalPaise,
        rate_basis: s.rate_basis ?? "lumpsum",
        other_label: str(s.other_label),
      };
    });
    await ctx.supabase.from("campaign_services").insert(serviceRows);
  }

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "created",
    description: `Draft campaign "${d.campaign_name}" saved`,
  });

  revalidatePath("/campaigns");
  return { success: true, id: campaignId };
}

// ─── Change request: request changes to confirmed+ campaign ─────────────────

export async function createChangeRequest(
  campaignId: string,
  values: unknown
): Promise<{ error?: string }> {
  const parsed = changeRequestSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  // Verify campaign exists and is in a locked status
  const { data: campaign } = await ctx.supabase
    .from("campaigns")
    .select("status, campaign_name")
    .eq("id", campaignId)
    .single();

  if (!campaign) return { error: "Campaign not found" };

  const editableStatuses: CampaignStatus[] = ["enquiry", "proposal_sent"];
  if (editableStatuses.includes(campaign.status)) {
    return { error: "Campaign can be edited directly — no change request needed" };
  }
  if (campaign.status === "cancelled") {
    return { error: "Cannot request changes on a cancelled campaign" };
  }

  // Check for existing pending request
  const { count } = await ctx.supabase
    .from("campaign_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");

  if ((count ?? 0) > 0) {
    return { error: "A change request is already pending for this campaign" };
  }

  const { error } = await ctx.supabase
    .from("campaign_change_requests")
    .insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      requested_by: ctx.user.id,
      status: "pending",
      reason: parsed.data.reason,
      requested_at: new Date().toISOString(),
    });

  if (error) return { error: error.message };

  await ctx.supabase.from("campaign_activity_log").insert({
    organization_id: ctx.orgId,
    campaign_id: campaignId,
    user_id: ctx.user.id,
    action: "change_requested",
    description: `Change request: ${parsed.data.reason}`,
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Review change request (approve/reject) ─────────────────────────────────

export async function reviewChangeRequest(
  requestId: string,
  values: unknown
): Promise<{ error?: string }> {
  const parsed = reviewChangeRequestSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  // Verify user role (admin/executive). Checks roles[] first (multi-role
  // users), falling back to the primary role column.
  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("role, roles")
    .eq("id", ctx.user.id)
    .single();

  const allowed = ["super_admin", "admin", "manager", "executive"];
  const userRoles: string[] =
    Array.isArray((profile as { roles?: string[] } | null)?.roles) &&
    ((profile as { roles?: string[] } | null)?.roles?.length ?? 0) > 0
      ? ((profile as { roles?: string[] }).roles as string[])
      : profile?.role
        ? [profile.role]
        : [];

  if (!profile || !userRoles.some((r) => allowed.includes(r))) {
    return { error: "Only admins, managers and executives can review change requests" };
  }

  // Fetch the request
  const { data: request } = await ctx.supabase
    .from("campaign_change_requests")
    .select("campaign_id, status")
    .eq("id", requestId)
    .single();

  if (!request) return { error: "Change request not found" };
  if (request.status !== "pending") return { error: "Request already reviewed" };

  const d = parsed.data;
  const now = new Date().toISOString();

  // Update request
  const { error } = await ctx.supabase
    .from("campaign_change_requests")
    .update({
      status: d.status,
      reviewed_by: ctx.user.id,
      reviewed_at: now,
      rejection_reason: d.status === "rejected" ? (d.rejection_reason ?? null) : null,
    })
    .eq("id", requestId);

  if (error) return { error: error.message };

  const campaignId = request.campaign_id;

  if (d.status === "approved") {
    // Revert campaign to enquiry so changes can be made
    await ctx.supabase
      .from("campaigns")
      .update({ status: "enquiry", updated_by: ctx.user.id })
      .eq("id", campaignId);

    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "change_approved",
      description: "Change request approved — campaign reverted to Enquiry for editing",
      old_value: "confirmed",
      new_value: "enquiry",
    });
  } else {
    await ctx.supabase.from("campaign_activity_log").insert({
      organization_id: ctx.orgId,
      campaign_id: campaignId,
      user_id: ctx.user.id,
      action: "change_rejected",
      description: `Change request rejected${d.rejection_reason ? `: ${d.rejection_reason}` : ""}`,
    });
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return {};
}

// ─── Delete campaign (soft delete) ───────────────────────────────────────────

export async function deleteCampaign(id: string): Promise<{ error?: string }> {
  const ctx = await getOrgAndUser();
  if (!ctx) return { error: "Not authenticated" };

  const { error } = await ctx.supabase
    .from("campaigns")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/campaigns");
  return {};
}
