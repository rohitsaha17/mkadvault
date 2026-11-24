// Auth layout — dark themed background with a polished glass card.
// Used by login, register, forgot-password and the one-time setup page.
// We force the `dark` class locally so this section looks consistent
// regardless of the global theme toggle.
import Image from "next/image";
import { setRequestLocale } from "next-intl/server";
import trails from "@/assets/dashboard/light-trails.webp";
import { BrandMark } from "@/components/shared/BrandMark";

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
      {/* Traffic light trails along the bottom, soft lime light from above */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Image
          src={trails}
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-bottom opacity-60 mix-blend-screen [mask-image:linear-gradient(to_top,black,transparent_80%)]"
        />
        <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_0%,rgb(181_247_69/0.12),transparent_70%)]" />
      </div>

      <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
        {/* Brand header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size={56} className="mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            MK ADD VAULT
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Outdoor Advertising Management
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-md">{children}</div>

        {/* Footer */}
        <p className="mt-8 text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} MK ADD VAULT
        </p>
      </div>
    </div>
  );
}
