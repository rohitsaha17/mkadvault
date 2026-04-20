"use server";
// Onboarding Server Action — creates a new organization and links the
// current user's profile to it with their chosen role.
// Uses the admin (service-role) client because:
//   1. organizations table has no INSERT RLS policy (by design)
//   2. profiles RLS only lets users update their own row (not org_id)
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const createOrgSchema = z.object({
  org_name: z.string().min(2, "Organisation name must be at least 2 characters"),
  city: z.string().optional(),
  state: z.string().optional(),
  role: z.enum([
    "super_admin",
    "admin",
    "sales_manager",
    "operations_manager",
    "accounts",
  ]),
});

type ActionResult = { error: string } | { success: string };

export async function createOrganization(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const raw = {
    org_name: formData.get("org_name") as string,
    city: (formData.get("city") as string) || undefined,
    state: (formData.get("state") as string) || undefined,
    role: formData.get("role") as string,
  };

  const parsed = createOrgSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Verify the user is authenticated via the regular client
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be logged in to create an organisation." };
  }

  // Use admin client for DB writes (bypasses RLS for org creation)
  const admin = createAdminClient();

  // Check if this user already has an org (prevent double-create)
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (existingProfile?.org_id) {
    redirect("/dashboard");
  }

  // Create the organisation
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: parsed.data.org_name,
      city: parsed.data.city || null,
      state: parsed.data.state || null,
    })
    .select("id")
    .single();

  if (orgError) {
    return { error: `Failed to create organisation: ${orgError.message}` };
  }

  // Link the user's profile to this new org with chosen role
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      org_id: org.id,
      role: parsed.data.role,
    })
    .eq("id", user.id);

  if (profileError) {
    return { error: `Failed to link your account: ${profileError.message}` };
  }

  redirect("/dashboard");
}
