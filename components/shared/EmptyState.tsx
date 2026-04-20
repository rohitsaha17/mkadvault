// EmptyState — reusable zero-data placeholder shown when a list/table has no rows.
// Theme-aware, works on light and dark backgrounds. Accepts an optional
// `variant="card"` to render inside a bordered card container.
import React from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * "plain"  — bare content (default)
   * "card"   — wrapped in a dashed-border card, useful as a drop-in replacement
   *            for an empty list body
   */
  variant?: "plain" | "card";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "plain",
  className,
}: Props) {
  const content = (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:from-indigo-500/15 dark:to-violet-500/15 dark:text-indigo-300 ring-1 ring-inset ring-indigo-500/20">
          {icon}
        </div>
      )}

      <h3 className="text-base font-semibold text-foreground">{title}</h3>

      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );

  if (variant === "card") {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border bg-muted/20",
          className
        )}
      >
        {content}
      </div>
    );
  }

  return <div className={className}>{content}</div>;
}
