"use client";
// AcceptInviteForm — welcomes the invited user, confirms who they are,
// and collects the details needed to activate the account:
//   * Full name (editable, pre-filled from the invite so the admin's
//     spelling is the default but the invitee can fix typos)
//   * Email (locked — the invite link already proved ownership)
//   * Phone (optional — lets the invitee provide a contact number up front)
//   * Password + confirm
//
// On submit we POST everything to /api/accept-invite, which:
//   1. Sets the password via the admin client
//   2. Clears user_metadata.needs_password_setup
//   3. Writes full_name + phone onto the profile row
// Then the client router.refresh()es server components and pushes to
// /dashboard. From there the proxy sees that needs_password_setup is false
// and lets the user through.
//
// We deliberately route through /api/accept-invite (JSON fetch) rather
// than a Server Action — this avoids the "An unexpected response was
// received from the server" class of failure that plagued the rest of
// the app before we moved those flows to API routes.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, PartyPopper, Mail, User as UserIcon, Phone, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z
  .object({
    fullName: z
      .string()
      .min(1, "Full name is required")
      .max(120, "Full name is too long"),
    // Phone is optional — but if provided, keep it to something sensible.
    // We don't enforce a specific format so international numbers work.
    phone: z
      .string()
      .max(32, "Phone number is too long")
      .optional()
      .or(z.literal("")),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  email: string;
  fullName: string | null;
  phone: string | null;
  orgName: string | null;
}

export function AcceptInviteForm({ email, fullName, phone, orgName }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: fullName ?? "",
      phone: phone ?? "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      let res: Response;
      try {
        res = await fetch("/api/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            full_name: values.fullName,
            phone: values.phone ?? "",
            password: values.password,
          }),
        });
      } catch (networkErr) {
        toast.error(
          networkErr instanceof Error
            ? `Network error: ${networkErr.message}`
            : "Network error. Please try again.",
        );
        return;
      }

      let data: { success?: true; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        toast.error("Unexpected server response. Please try again.");
        return;
      }

      if (data.error) {
        toast.error(data.error);
        return;
      }

      toast.success(
        orgName
          ? `Welcome to ${orgName}! Taking you to your dashboard…`
          : "All set! Taking you to your dashboard…",
      );
      // router.refresh() so server components re-read the cleared
      // needs_password_setup flag; then push to /dashboard.
      router.refresh();
      router.push("/dashboard");
    } finally {
      setIsSubmitting(false);
    }
  }

  const greetingName = fullName?.split(" ")[0] || "there";

  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-8 max-w-md w-full">
      {/* Welcome header */}
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <PartyPopper className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Welcome, {greetingName}!
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgName
            ? `You've been invited to join ${orgName}.`
            : "You've been invited to join your team."}{" "}
          Set up your account to get started.
        </p>
      </div>

      {/* Read-only email display — confirms which invite they're accepting */}
      {email && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Email
            </p>
            <p className="truncate font-medium text-foreground">{email}</p>
          </div>
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Locked
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Full name — editable, pre-filled */}
        <div className="space-y-1.5">
          <Label htmlFor="fullName" className="flex items-center gap-1.5">
            <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Full name
          </Label>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Priya Sharma"
            disabled={isSubmitting}
            {...register("fullName")}
          />
          {errors.fullName && (
            <p className="text-xs text-destructive">{errors.fullName.message}</p>
          )}
        </div>

        {/* Phone — optional */}
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            Phone{" "}
            <span className="text-[10px] font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+91 98XXXXXXXX"
            disabled={isSubmitting}
            {...register("phone")}
          />
          {errors.phone && (
            <p className="text-xs text-destructive">{errors.phone.message}</p>
          )}
        </div>

        {/* New Password */}
        <div className="space-y-1.5">
          <Label htmlFor="password" className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            Create a password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Min 8 characters"
            disabled={isSubmitting}
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword" className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            Confirm password
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter password"
            disabled={isSubmitting}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Setting up your account…
            </>
          ) : (
            "Complete setup & sign in"
          )}
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          Your email above is locked to this invite. You can change your name,
          phone, or password any time from account settings.
        </p>
      </form>
    </div>
  );
}
