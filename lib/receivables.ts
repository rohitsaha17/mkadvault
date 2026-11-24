// Money clients owe us (invoices): what is overdue, and by how long.
//
// Like rent in lib/payables.ts, "overdue" is worked out from due_date. No
// background job ever moves an invoice to the stored "overdue" status, so a
// screen that relies on it shows ₹0 overdue forever.
import type { InvoiceStatus } from "@/lib/types/database";

/** Issued and not fully settled: the invoices we are still waiting on. */
export const OPEN_INVOICE_STATUSES = ["sent", "partially_paid", "overdue"];

/** Issued to a client. Leaves out drafts and cancelled invoices. */
export const ISSUED_INVOICE_STATUSES = [...OPEN_INVOICE_STATUSES, "paid"];

export interface ReceivableRow {
  status: string;
  due_date: string | null;
  /** Leave out where a list doesn't load it; an open invoice is then owed. */
  balance_due_paise?: number | null;
}

/** Whole days past the due date; zero or less means not late. */
export function daysPastDue(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  return Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
}

export function isOverdue(row: ReceivableRow, today: string): boolean {
  return (
    OPEN_INVOICE_STATUSES.includes(row.status) &&
    row.balance_due_paise !== 0 &&
    daysPastDue(row.due_date, today) > 0
  );
}

/** The status to show today. A stale "overdue" that isn't late reads "sent". */
export function invoiceState(row: ReceivableRow, today: string): InvoiceStatus {
  if (isOverdue(row, today)) return "overdue";
  return row.status === "overdue" ? "sent" : (row.status as InvoiceStatus);
}

export type AgeBucket = "notDue" | "d1to30" | "d31to60" | "d61to90" | "d90plus";

export function ageBucket(dueDate: string | null, today: string): AgeBucket {
  const days = daysPastDue(dueDate, today);
  if (days <= 0) return "notDue";
  if (days <= 30) return "d1to30";
  if (days <= 60) return "d31to60";
  if (days <= 90) return "d61to90";
  return "d90plus";
}

export function emptyAgeing(): Record<AgeBucket, number> {
  return { notDue: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
}

export function summariseReceivables(rows: ReceivableRow[], today: string) {
  const ageing = emptyAgeing();
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const row of rows) {
    if (!OPEN_INVOICE_STATUSES.includes(row.status)) continue;
    const balance = row.balance_due_paise ?? 0;
    outstanding += balance;
    ageing[ageBucket(row.due_date, today)] += balance;
    if (isOverdue(row, today)) {
      overdue += balance;
      overdueCount += 1;
    }
  }
  return { outstanding, overdue, overdueCount, ageing };
}
