// PageHeader — shared header used at the top of every dashboard page.
// Provides consistent layout for title, description, and trailing actions,
// with an optional eyebrow label (e.g. "Inventory / Sites"). Drop-in:
//
//   <PageHeader
//     eyebrow="Inventory"
//     title="Sites"
//     description="Manage your OOH inventory across all cities."
//     actions={<Button>Add Site</Button>}
//   />
import React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Optional slot rendered below the header row — e.g. a filter bar */
  children?: React.ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-6 md:mb-8", className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}
