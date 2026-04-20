"use client";
// MobileSidebar — slide-out nav drawer for mobile screens.
// Mirrors the desktop Sidebar's grouped sections and theme tokens.
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, MapPin, Home, Building2, FileText,
  Users, Megaphone, Receipt, FileSpreadsheet, BarChart3,
  Bell, Settings, LogOut, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { logoutAction } from "@/app/[locale]/(auth)/actions";
import type { Profile } from "@/lib/types/database";

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

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
}

export function MobileSidebar({ open, onClose, profile }: MobileSidebarProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname.endsWith("/dashboard");
    return pathname.startsWith(href) || pathname.includes(`${href}/`);
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-white text-left flex items-center gap-3">
            <div className="relative h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
              <Sparkles className="h-4 w-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm tracking-tight truncate leading-tight">
                {tCommon("app_name")}
              </p>
              <p className="text-[10px] text-sidebar-foreground/60 uppercase tracking-wider font-medium mt-0.5">
                OOH Platform
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="space-y-1">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/40">
                {t(section.label as "workspace" | "inventory" | "revenue" | "insights")}
              </p>
              {section.items.map(({ key, href, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={key}
                    href={href}
                    onClick={onClose}
                    prefetch
                    className={cn(
                      "group relative w-full flex items-center gap-3 h-10 px-3 rounded-lg text-sm transition-all",
                      active
                        ? "bg-sidebar-accent text-white font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white"
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gradient-to-b from-indigo-400 to-violet-500" />
                    )}
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        active ? "text-white" : "text-sidebar-foreground/60 group-hover:text-white"
                      )}
                    />
                    <span className="truncate">{t(key as keyof typeof t)}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/40 p-2 pr-3">
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-sidebar-border">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {profile?.full_name ?? "User"}
              </p>
              <p className="text-[10px] text-sidebar-foreground/60 truncate capitalize">
                {profile?.role?.replace(/_/g, " ") ?? ""}
              </p>
            </div>
            <button
              onClick={() => logoutAction()}
              className="text-sidebar-foreground/60 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-sidebar-accent"
              aria-label={t("logout")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
