"use client";
// SetupForm — collects org details + first admin credentials.
// Calls the runSetup server action which creates everything in one transaction.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, User, Lock, MapPin } from "lucide-react";
import { runSetup } from "./actions";

export function SetupForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);

    // Basic client-side password confirmation check
    const password  = formData.get("password")  as string;
    const confirm   = formData.get("confirm")   as string;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      const result = await runSetup(formData);
      // If we get here, an error occurred (success redirects, so it never returns)
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Organisation details ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <Building2 className="h-4 w-4" />
          Your Organisation
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="org_name">Organisation / Agency Name *</Label>
          <Input
            id="org_name"
            name="org_name"
            required
            placeholder="e.g. Mumbai Outdoor Ads Pvt Ltd"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" name="city" placeholder="Mumbai" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="state">State</Label>
            <Input id="state" name="state" placeholder="Maharashtra" />
          </div>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* ── Admin account ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <User className="h-4 w-4" />
          Your Admin Account
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="full_name">Your Full Name *</Label>
          <Input
            id="full_name"
            name="full_name"
            required
            placeholder="e.g. Rohit Saha"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email Address *</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@yourcompany.com"
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* ── Password ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <Lock className="h-4 w-4" />
          Set a Password
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password * (min 8 characters)</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm Password *</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
          />
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Submit ─────────────────────────────────────────────────────────── */}
      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Setting up…
          </>
        ) : (
          "Create Organisation & Sign In"
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        This page is only available once — it will lock after setup completes.
      </p>
    </form>
  );
}
