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
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <p className="text-sm text-foreground">{state.success}</p>
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
