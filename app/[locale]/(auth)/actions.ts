"use server";
// Auth Server Actions — run on the server, called from Client Component forms.
// Zod validates on the server side as a second layer (client already validates).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseJs } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

import { isNextInternalThrow, toActionError } from "@/lib/actions/safe";
/**
 * Derive the current site's origin from request headers so reset-password /
 * magic-link emails always point at the host the user is actually on —
 * localhost in dev, the Vercel URL in prod, the custom domain once linked.
 *
 * Falls back to NEXT_PUBLIC_APP_URL, then localhost, in that order.
 */
async function getSiteOrigin(): Promise<string> {
  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host");
  const forwardedProto = h.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

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
  try {
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

    // Invalidate the router cache so the first post-login navigation doesn't
    // replay a stale unauthenticated RSC snapshot (which was causing the
    // "This page couldn't load" flash before a manual reload).
    revalidatePath("/", "layout");

    // Redirect to dashboard after successful login
    redirect("/dashboard");
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "loginAction");
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
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
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "registerAction");
  }
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const raw = { email: formData.get("email") as string };

    const parsed = forgotPasswordSchema.safeParse(raw);
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message };
    }

    const origin = await getSiteOrigin();

    // Use a plain supabase-js client (NOT @supabase/ssr) with flowType
    // 'implicit' so `resetPasswordForEmail` does NOT go through PKCE.
    //
    // Why: the SSR client ships with flowType 'pkce' by default. PKCE
    // needs a code verifier to be stored when the email is requested
    // and read back when the user clicks the link. In a Next.js 16
    // Server Action, the verifier is written to an httpOnly cookie via
    // the response, but in our setup the cookie was not persisting to
    // the browser (Flight response under useActionState doesn't reliably
    // propagate Set-Cookie for the code-verifier). End result: clicking
    // the reset link failed with
    //     "PKCE code verifier not found in storage."
    //
    // By using the implicit/token flow, Supabase emails a link shaped
    // like `/auth/confirm?token_hash=...&type=recovery&next=...`. Our
    // AuthLinkHandler already verifies that via `verifyOtp({ token_hash,
    // type: 'recovery' })` with zero cookie dependency — bulletproof.
    const supabaseRecovery = createSupabaseJs(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          flowType: "implicit",
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    const { error } = await supabaseRecovery.auth.resetPasswordForEmail(
      parsed.data.email,
      {
        redirectTo: `${origin}/auth/confirm?next=/reset-password`,
      }
    );

    if (error) {
      return { error: error.message };
    }

    return {
      success: "Password reset link sent! Check your email.",
    };
  } catch (err) {
    if (isNextInternalThrow(err)) throw err;
    return toActionError(err, "forgotPasswordAction");
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
