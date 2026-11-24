"use client";
// The rent schedule on a contract. The badge and the Record button go by the
// due date (see lib/payables.ts): the stored status never moves on by itself,
// so rent that fell due after the contract was entered used to stay "upcoming"
// with no way to record it.
import { StatusBadge } from "@/components/shared/StatusBadge";
import { payableState } from "@/lib/payables";
import { inr, fmt } from "@/lib/utils";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import type { ContractPayment } from "@/lib/types/database";

interface Props {
  payments: ContractPayment[];
  /** Today in India, from the server, so both sides agree on what is late. */
  today: string;
}

export function PaymentScheduleTable({ payments, today }: Props) {
  if (payments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">No payment schedule generated.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Due Date</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Amount Due</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Paid</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">TDS</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Mode</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((p) => {
            const state = payableState(p, today);
            const canRecord =
              state === "due" ||
              state === "overdue" ||
              state === "partially_paid";
            return (
              <tr key={p.id} className="hover:bg-muted">
                <td className="px-3 py-2.5 whitespace-nowrap">{fmt(p.due_date)}</td>
                <td className="px-3 py-2.5">{inr(p.amount_due_paise)}</td>
                <td className="px-3 py-2.5">
                  {p.amount_paid_paise ? inr(p.amount_paid_paise) : "—"}
                </td>
                <td className="px-3 py-2.5">
                  {p.tds_deducted_paise ? inr(p.tds_deducted_paise) : "—"}
                </td>
                <td className="px-3 py-2.5 capitalize">
                  {p.payment_mode?.replace(/_/g, " ") ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={state} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  {canRecord && (
                    <RecordPaymentDialog
                      paymentRowId={p.id}
                      amountDuePaise={p.amount_due_paise}
                      dueDate={fmt(p.due_date)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
