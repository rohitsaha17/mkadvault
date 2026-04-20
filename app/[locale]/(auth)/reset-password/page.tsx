"use client";
// ResetPasswordPage — lets the user set a new password after clicking
// the password-reset link in their email. The user already has a valid
// session at this point (established by the /auth/callback route).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
  });

  async function onSubmit(values: ResetPasswordFormValues) {
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: values.password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Password updated successfully! Please log in.");
      router.push("/login");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          Reset Password
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your new password below.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* New Password */}
        <div className="space-y-1.5">
          <Label htmlFor="password">New Password</Label>
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
          <Label htmlFor="confirmPassword">Confirm Password</Label>
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

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating...
            </>
          ) : (
            "Reset Password"
          )}
        </Button>
      </form>
    </div>
  );
}
