// Forgot password page — sends a Supabase password reset email.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("auth");

  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {t("forgotPasswordTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("forgotPasswordSubtitle")}
        </p>
      </div>

      <ForgotPasswordForm />

      <div className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          ← {t("backToLogin")}
        </Link>
      </div>
    </div>
  );
}
