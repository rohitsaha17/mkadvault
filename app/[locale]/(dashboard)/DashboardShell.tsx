"use client";
// DashboardShell — client component that owns sidebar collapsed state.
// Receives serializable profile + locale from the Server layout and
// renders Sidebar + TopBar + main content with correct layout.
import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
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
      {/* Sidebar — fixed left column, hidden on mobile */}
      <Sidebar profile={profile} email={email} onCollapsedChange={setSidebarCollapsed} />

      {/* Right column: top header + scrollable page content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar profile={profile} email={email} />
        {/* Subtle gradient backdrop behind content to add depth */}
        <main className="relative flex-1 overflow-y-auto">
          <div
            aria-hidden
            className="pointer-events-none sticky top-0 -mb-px h-px w-full bg-gradient-to-b from-background to-transparent"
          />
          <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6 lg:p-8 page-transition">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
