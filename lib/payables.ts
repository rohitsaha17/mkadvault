// Rent owed to landowners and agencies (contract_payments): what is overdue,
// what is due soon, and what is still to come.
//
// Timing always comes from due_date, never from the stored status. The status
// is written once, when the contract is entered ("due" if the date has already
// gone by, otherwise "upcoming"), and only changes when a payment is recorded.
// Nothing moves a row on as the days pass and nothing ever writes "overdue",
// so a screen that trusts the status shows ₹0 overdue forever.
//
// Every screen that totals rent owed should use this file, so they all agree.
import type { createClient } from "@/lib/supabase/server";
import type { PaymentStatus } from "@/lib/types/database";
import { shiftDate } from "@/lib/utils/time-buckets";

export const PAYABLE_WINDOW_DAYS = 30;

export interface PayableRow {
  due_date: string;
  amount_due_paise: number | null;
  amount_paid_paise: number | null;
  tds_deducted_paise: number | null;
  status: string;
}

export interface PayablesSummary {
  overdue: number;
  overdueCount: number;
  oldestOverdue: string | null;
  dueSoon: number;
  dueSoonCount: number;
  later: number;
}

/** What is still owed: the rent, less what was paid and any TDS withheld. */
export function payableBalance(row: PayableRow): number {
  if (row.status === "paid") return 0;
  const settled =
    (row.amount_paid_paise ?? 0) + (row.tds_deducted_paise ?? 0);
  return Math.max(0, (row.amount_due_paise ?? 0) - settled);
}

/** The status to show someone today, worked out from the due date. */
export function payableState(row: PayableRow, today: string): PaymentStatus {
  const partPaid = (row.amount_paid_paise ?? 0) > 0;
  if (row.status === "paid" || (partPaid && payableBalance(row) === 0)) {
    return "paid";
  }
  if (row.due_date < today) return "overdue";
  if (row.due_date === today) return "due";
  return partPaid ? "partially_paid" : "upcoming";
}

/** Counts every unpaid rupee exactly once. Due today is not overdue yet. */
export function summarisePayables(
  rows: PayableRow[],
  today: string,
): PayablesSummary {
  const horizon = shiftDate(today, PAYABLE_WINDOW_DAYS);
  const summary: PayablesSummary = {
    overdue: 0,
    overdueCount: 0,
    oldestOverdue: null,
    dueSoon: 0,
    dueSoonCount: 0,
    later: 0,
  };
  for (const row of rows) {
    const balance = payableBalance(row);
    if (balance === 0) continue;
    if (row.due_date < today) {
      summary.overdue += balance;
      summary.overdueCount += 1;
      if (!summary.oldestOverdue || row.due_date < summary.oldestOverdue) {
        summary.oldestOverdue = row.due_date;
      }
    } else if (row.due_date <= horizon) {
      summary.dueSoon += balance;
      summary.dueSoonCount += 1;
    } else {
      summary.later += balance;
    }
  }
  return summary;
}

/**
 * Overdue and due-soon rent for the signed-in user's organisation (RLS scopes
 * it). Returns null when it can't be read, so a screen can say so instead of
 * claiming nothing is owed.
 */
export async function loadPayablesSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: string,
): Promise<PayablesSummary | null> {
  const { data, error } = await supabase
    .from("contract_payments")
    .select(
      "due_date, amount_due_paise, amount_paid_paise, tds_deducted_paise, status, contract:contracts(id)",
    )
    .neq("status", "paid")
    .lte("due_date", shiftDate(today, PAYABLE_WINDOW_DAYS))
    // Deleting a contract leaves its rent rows behind. RLS hides the deleted
    // contract, so rows with no contract are not owed any more.
    .not("contract", "is", null);

  if (error) {
    console.error("[payables] could not load:", error.message);
    return null;
  }
  return summarisePayables((data ?? []) as unknown as PayableRow[], today);
}
