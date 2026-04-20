// Register page — full name, email, password, confirm password.
// On success shows "check your email" message.
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { RegisterForm } from "./RegisterForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: `${t("register")} — OOH Platform` };
}

export default async function RegisterPage({
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
        <h2 className="text-xl font-semibold text-foreground">{t("register")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("registerSubtitle")}</p>
      </div>

      <RegisterForm />

      <div className="mt-6 text-center text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          {t("login")}
        </Link>
      </div>
    </div>
  );
}
