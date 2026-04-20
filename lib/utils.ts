import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format paise as INR with Indian grouping (e.g. ₹1,23,456) */
export function inr(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

/** Format ISO date string as "dd MMM yyyy" (e.g. 13 Apr 2026) */
export function fmt(date: string | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy");
}

/**
 * Escape PostgREST special characters to prevent filter injection
 * in Supabase `.or()` / `.ilike()` query strings.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,%()]/g, "");
}
