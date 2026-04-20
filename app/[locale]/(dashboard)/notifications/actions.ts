"use server";
// Server actions for alert notifications: mark read, dismiss, bulk ops

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Mark a single alert as read ──────────────────────────────────────────────

export async function markAlertRead(alertId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("alerts")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", alertId);

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

// ─── Mark all alerts as read for current user ─────────────────────────────────

export async function markAllAlertsRead(): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!profile) return { error: "Profile not found" };

  // Mark all unread alerts that belong to this user (by user_id or role)
  const { error } = await supabase
    .from("alerts")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("organization_id", profile.org_id)
    .eq("is_read", false)
    .or(`user_id.eq.${user.id},target_role.eq.${profile.role}`);

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

// ─── Dismiss an alert ─────────────────────────────────────────────────────────

export async function dismissAlert(alertId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("alerts")
    .update({ is_dismissed: true, is_read: true, read_at: new Date().toISOString() })
    .eq("id", alertId);

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

// ─── Bulk mark as read ────────────────────────────────────────────────────────

export async function bulkMarkRead(alertIds: string[]): Promise<{ error?: string }> {
  if (!alertIds.length) return {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("alerts")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .in("id", alertIds);

  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return {};
}

// ─── Bulk dismiss ─────────────────────────────────────────────────────────────

export async function bulkDismiss(alertIds: string[]): Promise<{ error?: string }> {
  if (!alertIds.length) return {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("alerts")
    .update({ is_dismissed: true, is_read: true, read_at: new Date().toISOString() })
    .in("id", alertIds);

  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return {};
}
