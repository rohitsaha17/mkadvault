"use client";
// AcceptInviteForm — welcomes the invited user and asks them to set a
// password. The email is already known (we authenticated them via the
// invite link), so we display it read-only rather than asking them to
// re-type it. We also clear the `needs_password_setup` flag so the proxy
// + auth callback stop routing them here.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, PartyPopper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

// We only ask for a password + confirm. The email is already proven by
// the active Supabase session (the invite link did the verification).
const schema = z
  .object({
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
  orgName: string | null;
}

export function AcceptInviteForm({ email, fullName, orgName }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const supabase = createClient();

      // Set the new password AND clear the needs_password_setup flag in a
      // single round-trip. updateUser merges `data` into user_metadata.
      const { error } = await supabase.auth.updateUser({
        password: values.password,
        data: { needs_password_setup: false },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success(
        orgName
          ? `Welcome to ${orgName}! Taking you to your dashboard…`
          : "All set! Taking you to your dashboard…"
      );
      // Let the toast show briefly, then navigate. router.refresh() ensures
      // server components re-read the updated metadata.
      router.refresh();
      router.push("/dashboard");
    } catch {
      toast.error("Something went wrong. Please try again.");
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
          Set a password to get started.
        </p>
      </div>

      {/* Read-only email display — confirms which invite they're accepting */}
      {email && (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Signed in as </span>
          <span className="font-medium text-foreground">{email}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* New Password */}
        <div className="space-y-1.5">
          <Label htmlFor="password">Create a password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            disabled={isSubmitting}
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
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
              Setting up…
            </>
          ) : (
            "Set password & continue"
          )}
        </Button>
      </form>
    </div>
  );
}
