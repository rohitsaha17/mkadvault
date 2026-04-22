// Login page — email + password form with react-hook-form + zod validation.
// On success, the form fetches /api/auth/login and then pushes to /dashboard.
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: `${t("login")} — OOH Platform` };
}

export default async function LoginPage({
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
        <h2 className="text-xl font-semibold text-foreground">{t("login")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("loginSubtitle")}</p>
      </div>

      {/* Suspense boundary is required because LoginForm calls
          useSearchParams() to surface ?error= toasts from auth-link
          redirects. Without it, Next.js bails out of static
          prerendering for /login with a 'missing-suspense' error. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link
          href="/register"
          className="font-medium text-primary hover:underline"
        >
          {t("signUp")}
        </Link>
      </div>
    </div>
  );
}
