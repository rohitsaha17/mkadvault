"use client";
// OnboardingView — step 1: choose Create Org or Join Existing.
// If Create Org, shows the org creation form inline.
import { useState, useActionState, useEffect } from "react";
import { toast } from "sonner";
import {
  Building2,
  Mail,
  Loader2,
  ArrowLeft,
  Crown,
  Shield,
  Briefcase,
  Calculator,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganization } from "./actions";

// Fast, fire-and-forget logout — hard-nav to /login immediately,
// clear the session in the background via the JSON API route. Same
// pattern UserMenu uses.
function doLogout() {
  try {
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // Ignore — we're navigating away anyway.
  }
  window.location.assign("/login");
}

// ── Role options ─────────────────────────────────────────────────────────────

const ROLES = [
  {
    value: "super_admin",
    label: "Owner / Managing Director",
    desc: "Full access to everything",
    icon: Crown,
  },
  {
    value: "admin",
    label: "Admin",
    desc: "Manage org settings, users & all data",
    icon: Shield,
  },
  {
    value: "manager",
    label: "Manager",
    desc: "Sales, operations & accounts — cannot change settings",
    icon: Briefcase,
  },
  {
    value: "executive",
    label: "Executive",
    desc: "Sales + operations: clients, campaigns, sites, mounting",
    icon: Briefcase,
  },
  {
    value: "accounts",
    label: "Accountant / Finance",
    desc: "Manage billing, invoices & payments",
    icon: Calculator,
  },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  userName: string;
}

type View = "choose" | "create" | "join";

export function OnboardingView({ userName }: Props) {
  const [view, setView] = useState<View>("choose");
  const [selectedRole, setSelectedRole] = useState("super_admin");
  const [state, formAction, isPending] = useActionState(createOrganization, null);

  useEffect(() => {
    if (state && "error" in state) {
      toast.error(state.error);
    }
  }, [state]);

  // ── Choose view ──────────────────────────────────────────────────────────

  if (view === "choose") {
    return (
      <div className="rounded-2xl border border-border bg-card card-elevated p-8 max-w-lg w-full">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold text-foreground">
            Welcome, {userName}!
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How would you like to get started?
          </p>
        </div>

        <div className="grid gap-4">
          {/* Create new org */}
          <button
            onClick={() => setView("create")}
            className="group relative flex items-start gap-4 rounded-xl border border-border p-5 text-left transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-md"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                Create a New Organisation
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                I&apos;m setting up my OOH agency on this platform for the first
                time
              </p>
            </div>
          </button>

          {/* Join existing org */}
          <button
            onClick={() => setView("join")}
            className="group relative flex items-start gap-4 rounded-xl border border-border p-5 text-left transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-md"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 group-hover:bg-violet-500/15">
              <Mail className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                Join an Existing Organisation
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                My admin already invited me — I&apos;m waiting for the invite
                link
              </p>
            </div>
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => doLogout()}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // ── Join existing view ───────────────────────────────────────────────────

  if (view === "join") {
    return (
      <div className="rounded-2xl border border-border bg-card card-elevated p-8 max-w-lg w-full">
        <button
          onClick={() => setView("choose")}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="text-center py-8">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10">
            <Mail className="h-8 w-8 text-violet-600 dark:text-violet-400" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            Waiting for an Invite
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
            Ask your organisation&apos;s admin to invite you from{" "}
            <span className="font-medium text-foreground">
              Settings → Users → Invite User
            </span>
            . You&apos;ll receive an email with a link to join.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Once invited, log in again and you&apos;ll be taken directly to
            your dashboard.
          </p>
        </div>

        <div className="flex justify-center gap-3 mt-4">
          <Button variant="outline" onClick={() => setView("choose")}>
            Go Back
          </Button>
          <Button variant="outline" onClick={() => doLogout()}>
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  // ── Create org view ──────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-8 max-w-lg w-full">
      <button
        onClick={() => setView("choose")}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">
          Create Your Organisation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up your OOH agency. You can update these details later in
          Settings.
        </p>
      </div>

      <form action={formAction} className="space-y-5">
        {/* ── Org details ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Building2 className="h-3.5 w-3.5" />
            Organisation Details
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

        {/* ── Role selection ──────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Crown className="h-3.5 w-3.5" />
            Your Role in the Company
          </div>

          <div className="space-y-2">
            {ROLES.map((role) => {
              const Icon = role.icon;
              const isSelected = selectedRole === role.value;
              return (
                <label
                  key={role.value}
                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/30 hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={role.value}
                    checked={isSelected}
                    onChange={() => setSelectedRole(role.value)}
                    className="sr-only"
                  />
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                      isSelected
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium ${
                        isSelected ? "text-foreground" : "text-foreground/80"
                      }`}
                    >
                      {role.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{role.desc}</p>
                  </div>
                  <div
                    className={`h-4 w-4 rounded-full border-2 shrink-0 ${
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {isSelected && (
                      <div className="h-full w-full flex items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {state && "error" in state && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {state.error}
          </div>
        )}

        {/* ── Submit ───────────────────────────────────────────────────── */}
        <Button type="submit" className="w-full" size="lg" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating…
            </>
          ) : (
            "Create Organisation & Continue"
          )}
        </Button>
      </form>
    </div>
  );
}
