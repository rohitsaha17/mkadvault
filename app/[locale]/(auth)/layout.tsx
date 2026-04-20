// Auth layout — dark themed background with a polished glass card.
// Used by login, register, forgot-password and the one-time setup page.
// We force the `dark` class locally so this section looks consistent
// regardless of the global theme toggle.
import { setRequestLocale } from "next-intl/server";
import { Building2 } from "lucide-react";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="dark relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Subtle radial gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,theme(colors.slate.800/.6),transparent_60%),radial-gradient(ellipse_at_bottom_left,theme(colors.blue.900/.25),transparent_60%),radial-gradient(ellipse_at_bottom_right,theme(colors.indigo.900/.25),transparent_60%)]"
      />
      {/* Faint grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:32px_32px]"
      />

      <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
        {/* Brand header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-muted to-muted shadow-lg ring-1 ring-white/10">
            <Building2 className="h-6 w-6 text-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            OOH Platform
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Outdoor Advertising Management
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-md">{children}</div>

        {/* Footer */}
        <p className="mt-8 text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} OOH Platform
        </p>
      </div>
    </div>
  );
}
