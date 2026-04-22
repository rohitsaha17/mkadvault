"use client";
// Shared handler rendered by /auth/callback, /auth/confirm, and
// /auth/verify. Supabase emits THREE different email-link shapes
// depending on project auth-flow settings and email-template version:
//
//   1. PKCE flow:
//        /auth/callback?code=<pkce>
//      Server can exchange the code. We handle this with
//      supabase.auth.exchangeCodeForSession() below — also works
//      client-side so we do it here for a uniform code path.
//
//   2. OTP verify (2024+ default):
//        /auth/confirm?token_hash=<hash>&type=invite&next=<url>
//      Uses supabase.auth.verifyOtp(). Also accepts legacy alias
//      ?token=<hash> for older templates.
//
//   3. Implicit flow (old default, still common):
//        /auth/callback#access_token=<...>&refresh_token=<...>&type=<t>
//      Tokens in URL FRAGMENT — never reach the server. This was the
//      case causing the "invite link is incomplete" error the user
//      kept hitting. Handled client-side with supabase.auth.setSession().
//
// After any of the three succeeds we read the user's metadata. If
// needs_password_setup is true (invitee), route to /accept-invite.
// Otherwise honor ?next= or fall back to /dashboard.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Status = "working" | "error";

export function AuthLinkHandler() {
  const [status, setStatus] = useState<Status>("working");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();

      // Parse query params and fragment. Fragment looks like
      //   #access_token=X&refresh_token=Y&expires_in=3600&type=invite
      // — same format as a URLSearchParams payload.
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(
        window.location.hash.replace(/^#/, ""),
      );

      const code = search.get("code");
      const tokenHash = search.get("token_hash") ?? search.get("token");
      const type =
        (search.get("type") as
          | "invite"
          | "signup"
          | "magiclink"
          | "recovery"
          | "email_change"
          | null) ?? null;
      const next = search.get("next");

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const hashType = hash.get("type");
      const hashError =
        hash.get("error_description") ?? hash.get("error") ?? null;

      try {
        let established = false;
        let errorMessage: string | null = null;

        if (code) {
          // PKCE flow: exchange the one-time code for a session.
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          established = !error;
          errorMessage = error?.message ?? null;
        } else if (tokenHash && type) {
          // OTP verify flow.
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          established = !error;
          errorMessage = error?.message ?? null;
        } else if (accessToken && refreshToken) {
          // Implicit flow (fragment tokens).
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          established = !error;
          errorMessage = error?.message ?? null;
        } else if (hashError) {
          // Supabase sends errors in the fragment too, e.g.
          //   #error=access_denied&error_description=Email+link+is+invalid+or+has+expired
          errorMessage = decodeURIComponent(hashError.replace(/\+/g, " "));
        } else {
          errorMessage =
            "The invite link is incomplete. Ask your admin to resend the invite.";
        }

        if (!established) {
          throw new Error(errorMessage ?? "Could not verify the invite link.");
        }

        // Clear the fragment so it doesn't leak into browser history /
        // subsequent navigation. Also prevents a stray #access_token
        // from interfering with other pages.
        if (window.location.hash) {
          window.history.replaceState(
            {},
            "",
            window.location.pathname + window.location.search,
          );
        }

        // Who did we just sign in?
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const needsPasswordSetup =
          user?.user_metadata?.needs_password_setup === true;
        const isRecovery = type === "recovery" || hashType === "recovery";

        let destination: string;
        if (needsPasswordSetup) {
          destination = "/accept-invite";
        } else if (isRecovery) {
          destination = next ?? "/reset-password";
        } else {
          destination = next ?? "/dashboard";
        }

        if (cancelled) return;
        // Hard nav so the destination renders fresh with the new
        // session cookies (and the Supabase SSR cookie adapter picks
        // them up server-side on the next request).
        window.location.assign(destination);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error
            ? err.message
            : "Could not verify the invite link.";
        console.error("[AuthLinkHandler] verify failed:", err);
        setErrorMsg(msg);
        setStatus("error");
        toast.error(msg);
        // Send the user back to login with the error in the query so
        // they see it surfaced as a toast on the login page too.
        const loginUrl = new URL("/login", window.location.origin);
        loginUrl.searchParams.set("error", `Invite link problem: ${msg}`);
        setTimeout(() => {
          window.location.assign(loginUrl.toString());
        }, 2000);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
      {status === "working" ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Verifying your invite link…
          </p>
        </>
      ) : (
        <>
          <div className="rounded-full bg-destructive/10 p-4 text-destructive">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              We couldn&apos;t verify the invite link
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {errorMsg}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Taking you back to sign-in…
            </p>
          </div>
        </>
      )}
    </div>
  );
}
