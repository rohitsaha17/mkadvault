// Root layout — minimal shell: sets up fonts and html/body only.
// Locale-specific providers (NextIntlClientProvider, Toaster) live in
// app/[locale]/layout.tsx so they receive the correct locale.
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OOH Platform",
  description: "Outdoor advertising business management platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
