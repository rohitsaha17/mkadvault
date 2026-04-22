"use server";
// One-time initial setup action.
// Creates the organisation + first super_admin user using the service-role
// client (which bypasses RLS).  After this runs once, the guard at the top
// of every call makes it a no-op — so this can never be triggered again.

import { z } from "zod";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
// ─── Validation schema ────────────────────────────────────────────────────────

const setupSchema = z.object({
  org_name:   z.string().min(1, "Organisation name is required").max(200),
  full_name:  z.string().min(1, "Your name is required").max(100),
  email:      z.string().email("Invalid email address"),
  password:   z.string().min(8, "Password must be at least 8 characters"),
  city:       z.string().max(100).optional(),
  state:      z.string().max(100).optional(),
});

// ─── Action ───────────────────────────────────────────────────────────────────

export async function runSetup(formData: FormData): Promise<{ error: string } | never> {
  try {
    const admin = createAdminClient();

    // ── Guard: refuse if any org already exists ──────────────────────────────
    const { count } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true });

    if (count && count > 0) {
      return { error: "Setup has already been completed. Please sign in instead." };
    }

    // ── Validate input ───────────────────────────────────────────────────────
    const parsed = setupSchema.safeParse({
      org_name:  formData.get("org_name"),
      full_name: formData.get("full_name"),
      email:     formData.get("email"),
      password:  formData.get("password"),
      city:      formData.get("city") || undefined,
      state:     formData.get("state") || undefined,
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return { error: firstIssue?.message ?? "Invalid input" };
    }

    const { org_name, full_name, email, password, city, state } = parsed.data;

    // ── Step 1: Create organisation ─────────────────────────────────────────
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: org_name, city: city ?? null, state: state ?? null })
      .select("id")
      .single();

    if (orgErr || !org) {
      return { error: `Failed to create organisation: ${orgErr?.message ?? "unknown error"}` };
    }

    // ── Step 2: Create auth user (email_confirm: true skips the verify email step) ──
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,          // mark as verified immediately
      user_metadata: { full_name }, // trigger uses this to pre-fill full_name
    });

    if (authErr || !authData.user) {
      // Roll back: delete the org we just created
      await admin.from("organizations").delete().eq("id", org.id);
      return { error: `Failed to create user: ${authErr?.message ?? "unknown error"}` };
    }

    const userId = authData.user.id;

    // ── Step 3: Link profile → org + promote to super_admin ─────────────────
    // The trigger auto-created a bare profile row; we now fill in org_id + role.
    const { error: profileErr } = await admin
      .from("profiles")
      .update({
        org_id:    org.id,
        role:      "super_admin",
        full_name: full_name,
      })
      .eq("id", userId);

    if (profileErr) {
      // Non-fatal: user exists but won't have the right role.
      // Return error so they can try again from the Supabase dashboard.
      return { error: `User created but profile update failed: ${profileErr.message}` };
    }

    // ── Step 4: Sign in as the new user so we land in the dashboard ─────────
    const serverClient = await createClient();
    const { error: signInErr } = await serverClient.auth.signInWithPassword({ email, password });

    if (signInErr) {
      // User exists and is set up — just redirect to login to complete sign-in.
      redirect("/login");
    }

    // All done — go to the dashboard
    redirect("/dashboard");
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "runSetup");
  }
}
