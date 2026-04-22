"use client";
// Horizontal sub-nav shown on every /finance/* page so users can jump
// between the Finance module's sections without going back to the
// sidebar. Highlights the active tab based on the current pathname.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  CheckCheck,
  BadgeIndianRupee,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Each tab is keyed off a *suffix* of the path (the locale prefix may or
// may not be present depending on the user's language). We match by
// checking whether the pathname *ends with* the href or contains
// `${href}/`.
const TABS: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  // Only shown to finance roles (admin / accounts / manager / super_admin).
  financeOnly?: boolean;
}[] = [
  {
    href: "/finance",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Cash flow at a glance",
  },
  {
    href: "/finance/requests",
    label: "Requests",
    icon: ListChecks,
    description: "All payment requests",
  },
  {
    href: "/finance/approvals",
    label: "Approvals",
    icon: CheckCheck,
    description: "Pending your review",
    financeOnly: true,
  },
  {
    href: "/finance/payments",
    label: "Payments",
    icon: BadgeIndianRupee,
    description: "Settled with proofs",
  },
  {
    href: "/finance/receipts",
    label: "Receipts",
    icon: FileText,
    description: "Bills & payment proofs",
  },
];

interface Props {
  canSettle: boolean;
}

export function FinanceNav({ canSettle }: Props) {
  const pathname = usePathname();

  // Overview (/finance) needs an exact suffix match — otherwise it would
  // also light up on /finance/requests etc. The others can fuzzy-match.
  function isActive(href: string): boolean {
    if (href === "/finance") {
      return pathname === "/finance" || /\/[a-z]{2}\/finance$/.test(pathname);
    }
    return pathname.endsWith(href) || pathname.includes(`${href}/`);
  }

  const visible = TABS.filter((t) => !t.financeOnly || canSettle);

  return (
    <div className="mb-6 -mx-1 overflow-x-auto">
      <div className="flex min-w-max gap-1 px-1">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                "group inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
