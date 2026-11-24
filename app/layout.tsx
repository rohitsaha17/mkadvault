// Root layout — minimal shell: sets up fonts and html/body only.
// Locale-specific providers (NextIntlClientProvider, Toaster) live in
// app/[locale]/layout.tsx so they receive the correct locale.
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Instrument Serif — a quiet, editorial display face used ONCE per
// screen, for the dashboard period headline, section eyebrows and the
// hero figure. Everything else keeps Geist. Italic is included because
// Instrument's italic reads as a hand-lettered ledger, which is the
// character we want next to the tabular INR numbers.
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MK ADD VAULT",
  description: "MK ADD VAULT — outdoor advertising business management platform",
  // PWA glue. The manifest lives at app/manifest.ts. Apple needs
  // separate <meta> tags + apple-icon.tsx because Safari ignores the
  // standard manifest for some flags. statusBarStyle "black-translucent"
  // lets our app's brand bar show through behind the status bar.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MK ADD VAULT",
    statusBarStyle: "black-translucent",
  },
  applicationName: "MK ADD VAULT",
  formatDetection: { telephone: false },
};

// viewport / themeColor moved into their own export per Next 14+
// metadata API — both control how the OS chrome (status bar tint,
// safe-area insets) wraps the installed PWA.
export const viewport: Viewport = {
  // viewport-fit=cover lets us paint into the notch / home-bar safe
  // areas; we still pad content with env(safe-area-inset-*) inside.
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  // Two tones so the status bar / address bar tint matches whichever
  // colour scheme the device is in. Matches the brand navy used in
  // PDF headers + status pills.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4F46E5" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
