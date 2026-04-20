"use client";
import { useActionState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAction } from "../actions";

const registerSchema = z
  .object({
    fullName: z.string().min(2, "Full name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [state, formAction, isPending] = useActionState(registerAction, null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  useEffect(() => {
    if (state && "error" in state) {
      toast.error(state.error);
    }
  }, [state]);

  function onSubmit(_values: RegisterFormValues, event?: React.BaseSyntheticEvent) {
    event?.preventDefault();
    formAction(new FormData(event?.target as HTMLFormElement));
  }

  // Show success state after account is created
  if (state && "success" in state) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <p className="text-sm text-foreground max-w-xs">{state.success}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input
          id="fullName"
          type="text"
          autoComplete="name"
          placeholder="Rahul Sharma"
          disabled={isPending}
          {...register("fullName")}
        />
        {errors.fullName && (
          <p className="text-xs text-destructive">{errors.fullName.message}</p>
        )}
      </div>

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

      <div className="space-y-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="Min. 8 characters"
          disabled={isPending}
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat password"
          disabled={isPending}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {tCommon("loading")}
          </>
        ) : (
          t("createAccount")
        )}
      </Button>
    </form>
  );
}
