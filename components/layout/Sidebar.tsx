"use client";
// Sidebar — main navigation component.
// - Uses sidebar CSS tokens so it respects light/dark theme
// - Items are grouped into sections with visible labels (Workspace / Operations /
//   Revenue / Insights) so the growing nav stays scannable
// - Active state uses a left indicator rail + accent background instead of full fill
// - Collapses to a 16px icon rail on desktop, hidden on mobile (handled by MobileSidebar)
import { useState, useEffect } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  MapPin,
  Home,
  Building2,
  FileText,
  Users,
  Megaphone,
  Receipt,
  FileSpreadsheet,
  BarChart3,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "./UserMenu";
import type { Profile } from "@/lib/types/database";

// ─── Nav items grouped by section ─────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: "workspace",
    items: [
      { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "inventory",
    items: [
      { key: "sites", href: "/sites", icon: MapPin },
      { key: "landowners", href: "/landowners", icon: Home },
      { key: "agencies", href: "/agencies", icon: Building2 },
      { key: "contracts", href: "/contracts", icon: FileText },
    ],
  },
  {
    label: "revenue",
    items: [
      { key: "clients", href: "/clients", icon: Users },
      { key: "campaigns", href: "/campaigns", icon: Megaphone },
      { key: "proposals", href: "/proposals", icon: FileSpreadsheet },
      { key: "billing", href: "/billing", icon: Receipt },
    ],
  },
  {
    label: "insights",
    items: [
      { key: "reports", href: "/reports", icon: BarChart3 },
      { key: "notifications", href: "/notifications", icon: Bell },
      { key: "settings", href: "/settings", icon: Settings },
    ],
  },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface SidebarProps {
  profile: Profile | null;
  email?: string | null;
  onCollapsedChange?: (collapsed: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar({ profile, email, onCollapsedChange }: SidebarProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
    onCollapsedChange?.(next);
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname.endsWith("/dashboard");
    return pathname.startsWith(href) || pathname.includes(`${href}/`);
  }

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col h-full relative shrink-0 transition-[width] duration-300 ease-out",
        "bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      {/* ── Brand header ───────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center h-16 px-4 shrink-0 border-b border-sidebar-border",
          collapsed ? "justify-center" : "gap-3"
        )}
      >
        <div className="relative h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
          <Sparkles className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm tracking-tight text-white truncate leading-tight">
              {tCommon("app_name")}
            </p>
            <p className="text-[10px] text-sidebar-foreground/60 uppercase tracking-wider font-medium mt-0.5">
              OOH Platform
            </p>
          </div>
        )}
      </div>

      {/* ── Nav sections ───────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/40">
                {t(section.label as "workspace" | "inventory" | "revenue" | "insights")}
              </p>
            )}

            {section.items.map(({ key, href, icon: Icon }) => {
              const active = isActive(href);
              const label = t(key as keyof typeof t);
              const btnClass = cn(
                "group relative w-full flex items-center h-9 rounded-lg text-sm transition-all",
                collapsed ? "justify-center" : "gap-3 px-3",
                active
                  ? "bg-sidebar-accent text-white font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white"
              );
              // Use <Link> (not router.push on click) so Next.js prefetches the
              // route on hover/focus — makes navigation feel instant because the
              // RSC payload is already in memory by the time the user clicks.
              const button = (
                <Link
                  key={key}
                  href={href}
                  className={btnClass}
                  prefetch
                >
                  {/* Active left rail indicator */}
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gradient-to-b from-indigo-400 to-violet-500" />
                  )}
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 transition-colors",
                      active ? "text-white" : "text-sidebar-foreground/60 group-hover:text-white"
                    )}
                    strokeWidth={active ? 2.25 : 2}
                  />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );

              return collapsed ? (
                <Tooltip key={key}>
                  <TooltipTrigger>{button}</TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                button
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── User block (click to open account menu) ────────────────────── */}
      <div className="border-t border-sidebar-border p-3 shrink-0">
        {collapsed ? (
          <UserMenu
            profile={profile}
            email={email}
            side="right"
            align="end"
            triggerClassName="w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Tooltip>
              <TooltipTrigger render={<span className="block" />}>
                <div className="flex items-center justify-center">
                  <Avatar className="h-9 w-9 shrink-0 ring-2 ring-sidebar-border hover:ring-primary/50 transition-colors">
                    <AvatarImage src={profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {profile?.full_name ?? "Account"}
              </TooltipContent>
            </Tooltip>
          </UserMenu>
        ) : (
          <UserMenu
            profile={profile}
            email={email}
            side="top"
            align="start"
            triggerClassName="w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/40 hover:bg-sidebar-accent/70 p-2 pr-3 transition-colors cursor-pointer">
              <Avatar className="h-9 w-9 shrink-0 ring-2 ring-sidebar-border">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-semibold text-white truncate">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="text-[10px] text-sidebar-foreground/60 truncate capitalize">
                  {profile?.role?.replace(/_/g, " ") ?? "member"}
                </p>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-sidebar-foreground/60 shrink-0" />
            </div>
          </UserMenu>
        )}
      </div>

      {/* ── Collapse toggle ────────────────────────────────────────────── */}
      <button
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-20 h-6 w-6 rounded-full bg-sidebar border border-sidebar-border flex items-center justify-center text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-accent transition-colors z-10 shadow-sm"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>
    </aside>
  );
}
