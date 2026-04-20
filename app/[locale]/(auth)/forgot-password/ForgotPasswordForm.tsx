"use client";
import { useActionState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction } from "../actions";

const schema = z.object({
  email: z.string().email("Invalid email address"),
});
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [state, formAction, isPending] = useActionState(forgotPasswordAction, null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (state && "error" in state) toast.error(state.error);
  }, [state]);

  if (state && "success" in state) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        {/* Animated tick: halo pulse → circle pop → check-stroke draws */}
        <div className="relative flex h-20 w-20 items-center justify-center">
          <span
            aria-hidden
            className="success-tick-halo absolute inset-0 rounded-full bg-primary/30"
          />
          <svg
            viewBox="0 0 52 52"
            className="success-tick-circle relative h-20 w-20 drop-shadow-[0_0_16px_color-mix(in_oklch,var(--primary)_50%,transparent)]"
            aria-hidden
          >
            <circle
              cx="26"
              cy="26"
              r="24"
              fill="var(--primary)"
            />
            <path
              className="success-tick-check"
              d="M14 27 L23 36 L39 18"
              fill="none"
              stroke="var(--primary-foreground)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="success-tick-message space-y-1">
          <h3 className="text-base font-semibold text-foreground">
            {t("resetLinkSentTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{state.success}</p>
        </div>
      </div>
    );
  }

  function onSubmit(_v: FormValues, e?: React.BaseSyntheticEvent) {
    e?.preventDefault();
    formAction(new FormData(e?.target as HTMLFormElement));
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {tCommon("loading")}
          </>
        ) : (
          t("sendResetLink")
        )}
      </Button>
    </form>
  );
}
