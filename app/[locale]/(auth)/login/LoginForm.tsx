"use client";
// LoginForm — posts credentials to the /api/auth/login JSON route and,
// on success, pushes the user to /dashboard. We use a plain fetch()
// rather than a Server Action because the Server Action stack kept
// surfacing "An unexpected response was received from the server" on
// both this flow and the user-management flow; moving to JSON routes
// made the error class go away everywhere we applied it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginFormValues) {
    setIsPending(true);
    try {
      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            email: values.email,
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

      // Refresh so server components re-read the newly-signed-in cookies,
      // then push to dashboard. router.refresh() first ensures the
      // dashboard's server-rendered tree sees the fresh session.
      router.refresh();
      router.push("/dashboard");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Email */}
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          disabled={isPending}
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("password")}</Label>
          <Link
            href="/forgot-password"
            className="text-xs text-primary hover:underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          disabled={isPending}
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {tCommon("loading")}
          </>
        ) : (
          t("login")
        )}
      </Button>
    </form>
  );
}
