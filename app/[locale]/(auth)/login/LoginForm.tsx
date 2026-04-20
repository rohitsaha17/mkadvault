"use client";
// LoginForm — client component so it can use react-hook-form and useActionState.
import { useActionState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "../actions";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");

  // useActionState wires the form to the server action and tracks pending state
  const [state, formAction, isPending] = useActionState(loginAction, null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  // Show error toast when the server action returns an error
  useEffect(() => {
    if (state && "error" in state) {
      toast.error(state.error);
    }
  }, [state]);

  // handleSubmit runs client-side zod validation first, then submits to the action
  function onSubmit(_values: LoginFormValues, event?: React.BaseSyntheticEvent) {
    event?.preventDefault();
    const form = event?.target as HTMLFormElement;
    formAction(new FormData(form));
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
