"use client";
// UserMenu — reusable profile dropdown used by the TopBar (top-right) and the
// Sidebar (bottom-left user block). Centralises the set of account-related
// actions so both entry points always show the same menu.
//
// Items included:
//   • Signed-in-as header (name + email + role)
//   • My Profile        → /settings (personal info, avatar, language)
//   • Organization      → /settings (same page; settings page exposes both)
//   • Change Password   → /forgot-password (emails a reset link)
//   • Notifications     → /notifications
//   • Theme toggle      (light ↔ dark)
//   • Log out
//
// The trigger is passed in as `children` so the same menu can sit under either
// a large pill (sidebar) or a plain avatar (topbar).
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  User,
  Building2,
  KeyRound,
  Bell,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/[locale]/(auth)/actions";
import type { Profile } from "@/lib/types/database";

interface UserMenuProps {
  profile: Profile | null;
  email?: string | null;
  children: React.ReactNode; // the trigger content (avatar, pill, etc.)
  triggerClassName?: string;
  side?: "bottom" | "top" | "right" | "left";
  align?: "start" | "center" | "end";
}

export function UserMenu({
  profile,
  email,
  children,
  triggerClassName,
  side = "bottom",
  align = "end",
}: UserMenuProps) {
  const t = useTranslations("nav");
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const isDark = theme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          triggerClassName ??
          "outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        }
      >
        {children}
      </DropdownMenuTrigger>

      <DropdownMenuContent side={side} align={align} className="w-64">
        {/* ── Signed-in-as header ───────────────────────────────────────── */}
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5 py-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("signedInAs")}
            </p>
            <p className="text-sm font-semibold truncate">
              {profile?.full_name ?? "User"}
            </p>
            {email && (
              <p className="text-xs text-muted-foreground truncate">{email}</p>
            )}
            {profile?.role && (
              <p className="text-[11px] text-muted-foreground capitalize truncate mt-0.5">
                {profile.role.replace(/_/g, " ")}
              </p>
            )}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* ── Account actions ───────────────────────────────────────────── */}
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <User />
          <span>{t("myProfile")}</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <Building2 />
          <span>{t("organizationSettings")}</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => router.push("/forgot-password")}>
          <KeyRound />
          <span>{t("changePassword")}</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => router.push("/notifications")}>
          <Bell />
          <span>{t("notifications")}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Theme toggle ──────────────────────────────────────────────── */}
        <DropdownMenuItem
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? <Sun /> : <Moon />}
          <span>{t("toggleTheme")}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Logout ────────────────────────────────────────────────────── */}
        <DropdownMenuItem
          variant="destructive"
          onClick={() => logoutAction()}
        >
          <LogOut />
          <span>{t("logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
