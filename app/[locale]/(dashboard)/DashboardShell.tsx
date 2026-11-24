"use client";
// DashboardShell — client component that owns sidebar collapsed state.
// Receives serializable profile + locale from the Server layout and
// renders Sidebar + TopBar + main content with correct layout.
import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { PwaRegister } from "@/components/pwa/PwaRegister";
import type { Profile } from "@/lib/types/database";

interface DashboardShellProps {
  profile: Profile | null;
  email?: string | null;
  locale: string;
  children: React.ReactNode;
}

export function DashboardShell({ profile, email, children }: DashboardShellProps) {
  // Track collapsed state here so TopBar and main content can respond if needed
  const [, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* PwaRegister is invisible — registers the service worker on
          mount so Chrome's "Install app" prompt becomes eligible.
          See public/sw.js + app/manifest.ts. */}
      <PwaRegister />
      {/* Sidebar — fixed left column, hidden on mobile */}
      <Sidebar profile={profile} email={email} onCollapsedChange={setSidebarCollapsed} />

      {/* Right column: top header + scrollable page content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar profile={profile} email={email} />
        <main className="relative flex-1 overflow-y-auto">
          {/* Soft lime light falling onto the top of the page. The content is
              `relative` so it paints over this without a stacking context,
              which would trap pop-ups underneath the top bar. */}
          <div
            aria-hidden
            className="app-backdrop pointer-events-none absolute inset-x-0 top-0 h-[520px]"
          />
          <div className="relative mx-auto w-full max-w-[1600px] p-4 md:p-6 lg:p-8 page-transition">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
