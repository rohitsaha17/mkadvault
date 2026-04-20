"use client";
// TopBar — header bar shown above every dashboard page.
// Left: hamburger (mobile) + page title + live breadcrumb trail
// Right: search, notifications, theme toggle, locale switcher, user menu
import { useState } from "react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { Menu, Search, Sun, Moon, Languages, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MobileSidebar } from "./MobileSidebar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { logoutAction } from "@/app/[locale]/(auth)/actions";
import { useRouter, usePathname } from "@/i18n/navigation";
import type { Profile } from "@/lib/types/database";

// Map route segments to translation keys
const ROUTE_TITLES: Record<string, string> = {
  dashboard: "dashboard",
  sites: "sites",
  landowners: "landowners",
  agencies: "agencies",
  contracts: "contracts",
  clients: "clients",
  campaigns: "campaigns",
  billing: "billing",
  proposals: "proposals",
  reports: "reports",
  notifications: "notifications",
  settings: "settings",
};

interface TopBarProps {
  profile: Profile | null;
}

export function TopBar({ profile }: TopBarProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");

  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();

  const { theme, setTheme } = useTheme();

  const [mobileOpen, setMobileOpen] = useState(false);

  // Derive primary + secondary segments for breadcrumb
  const segments = pathname.split("/").filter(Boolean);
  const primaryKey = segments.find((s) => ROUTE_TITLES[s]) ?? "dashboard";
  const primaryLabel = t(primaryKey as keyof typeof t);

  // Second crumb: "New", "Edit", or an id-ish fallback
  const primaryIdx = segments.indexOf(primaryKey);
  const sub = primaryIdx >= 0 ? segments[primaryIdx + 1] : undefined;
  const subLabel = sub
    ? sub === "new"
      ? tCommon("add")
      : sub === "edit"
        ? tCommon("edit")
        : null
    : null;

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  function switchLocale() {
    const next = locale === "en" ? "hi" : "en";
    router.replace(pathname, { locale: next });
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <>
      <header className="sticky top-0 z-30 h-16 bg-background/85 backdrop-blur-md border-b border-border flex items-center gap-3 px-4 lg:px-6 shrink-0">
        {/* ── Mobile hamburger ─────────────────────────────────────────── */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* ── Breadcrumb-style title ───────────────────────────────────── */}
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <h1 className="text-[15px] font-semibold text-foreground truncate">
            {primaryLabel}
          </h1>
          {subLabel && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="text-[15px] text-muted-foreground truncate">
                {subLabel}
              </span>
            </>
          )}
        </div>

        {/* ── Search ───────────────────────────────────────────────────── */}
        <div className="hidden sm:flex items-center relative">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder={tCommon("search")}
            className="pl-9 h-9 w-48 lg:w-72 text-sm bg-muted/40 border-transparent focus-visible:bg-background focus-visible:border-border"
          />
          <kbd className="hidden lg:flex absolute right-2.5 top-1/2 -translate-y-1/2 h-5 items-center gap-0.5 rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground pointer-events-none">
            <span className="text-[11px]">⌘</span>K
          </kbd>
        </div>

        {/* ── Right action cluster ─────────────────────────────────────── */}
        <div className="flex items-center gap-1">
          <NotificationBell locale={locale} />

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
          </Button>

          {/* Language switcher */}
          <Button
            variant="ghost"
            size="icon"
            onClick={switchLocale}
            aria-label="Switch language"
            className="h-9 w-9 text-muted-foreground hover:text-foreground relative"
          >
            <Languages className="h-4 w-4" />
            <span className="absolute -bottom-0.5 -right-0.5 text-[9px] font-bold bg-primary text-primary-foreground rounded-sm px-1 leading-tight">
              {locale.toUpperCase()}
            </span>
          </Button>

          <div className="w-px h-6 bg-border mx-1" />

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-9 w-9 ring-2 ring-border hover:ring-primary/40 transition-colors">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold truncate">
                    {profile?.full_name ?? "User"}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize truncate">
                    {profile?.role?.replace(/_/g, " ") ?? ""}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                {t("settings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logoutAction()}
                className="text-destructive focus:text-destructive"
              >
                {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        profile={profile}
      />
    </>
  );
}
