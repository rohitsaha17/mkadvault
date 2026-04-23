"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "invoices", href: "/billing/invoices", label: "Invoices" },
  { key: "receipts", href: "/billing/receipts", label: "Receipts" },
  { key: "receivables", href: "/billing/receivables", label: "Receivables" },
  { key: "payables", href: "/billing/payables", label: "Payables" },
  { key: "reports", href: "/billing/reports", label: "Reports" },
];

export function BillingNav() {
  const pathname = usePathname();
  return (
    <div className="mb-5 flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = pathname.includes(t.key);
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
