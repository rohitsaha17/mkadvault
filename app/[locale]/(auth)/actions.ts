"use server";
// Auth Server Actions — run on the server, called from Client Component forms.
// Zod validates on the server side as a second layer (client already validates).
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ─── Validation schemas (server-side) ────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const registerSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// ─── Return type for all actions ─────────────────────────────────────────────

type ActionResult = { error: string } | { success: string };

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Don't expose internal error details — give a friendly message
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Invalid email or password. Please try again." };
    }
    return { error: error.message };
  }

  // Redirect to dashboard after successful login
  redirect("/dashboard");
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const raw = {
    fullName: formData.get("fullName") as string,
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    confirmPassword: formData.get("confirmPassword") as string,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        // This goes into auth.users.raw_user_meta_data
        // Our trigger reads full_name from here to create the profile row
        full_name: parsed.data.fullName,
      },
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "This email is already registered. Try logging in." };
    }
    return { error: error.message };
  }

  return {
    success:
      "Account created! Check your email for a confirmation link before logging in.",
  };
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const raw = { email: formData.get("email") as string };

  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
    }
  );

  if (error) {
    return { error: error.message };
  }

  return {
    success: "Password reset link sent! Check your email.",
  };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
