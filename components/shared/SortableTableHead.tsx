"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

interface SortableTableHeadProps {
  column: string;
  label: string;
  currentSort: string | null;
  currentDir: "asc" | "desc" | null;
}

export function SortableTableHead({
  column,
  label,
  currentSort,
  currentDir,
}: SortableTableHeadProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isActive = currentSort === column;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());

    if (isActive) {
      // Toggle direction when clicking the same column
      const newDir = currentDir === "asc" ? "desc" : "asc";
      params.set("sort", column);
      params.set("dir", newDir);
    } else {
      // Default to ascending for a new column
      params.set("sort", column);
      params.set("dir", "asc");
    }

    router.push(`?${params.toString()}`);
  }

  return (
    <th
      onClick={handleClick}
      className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer select-none group"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    </th>
  );
}
