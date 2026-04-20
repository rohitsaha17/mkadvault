// Locale layout — wraps every page with the correct i18n context.
// next-intl requires this layout so all Server and Client Components
// in this subtree can access translations for the right locale.
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { routing } from "@/i18n/routing";
import { notFound } from "next/navigation";

// Tell Next.js which locale segments are valid (for static generation)
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // params is a Promise in Next.js 16 — must await it
  const { locale } = await params;

  // Reject unknown locales so we get a 404, not broken UI
  if (!routing.locales.includes(locale as "en" | "hi")) {
    notFound();
  }

  // Enables static rendering for pages that use useTranslations()
  setRequestLocale(locale);

  // Load messages for the current locale — passed to the client provider
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>
        <TooltipProvider>
          {children}
          {/* Global toast notifications — position top-right */}
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
