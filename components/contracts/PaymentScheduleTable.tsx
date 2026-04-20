"use client";
import { Badge } from "@/components/ui/badge";
import { inr, fmt } from "@/lib/utils";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import type { ContractPayment } from "@/lib/types/database";

interface Props {
  payments: ContractPayment[];
  contractId: string;
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-50 text-blue-700 border-blue-200",
  due: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-green-50 text-green-700 border-green-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  partially_paid: "bg-orange-50 text-orange-700 border-orange-200",
};

export function PaymentScheduleTable({ payments, contractId: _contractId }: Props) {
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
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Due Date</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Amount Due</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Paid</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">TDS</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Mode</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((p) => (
            <tr key={p.id} className="hover:bg-muted">
              <td className="px-4 py-2.5 whitespace-nowrap">{fmt(p.due_date)}</td>
              <td className="px-4 py-2.5">{inr(p.amount_due_paise)}</td>
              <td className="px-4 py-2.5">
                {p.amount_paid_paise ? inr(p.amount_paid_paise) : "—"}
              </td>
              <td className="px-4 py-2.5">
                {p.tds_deducted_paise ? inr(p.tds_deducted_paise) : "—"}
              </td>
              <td className="px-4 py-2.5 capitalize">
                {p.payment_mode?.replace(/_/g, " ") ?? "—"}
              </td>
              <td className="px-4 py-2.5">
                <Badge
                  variant="outline"
                  className={`text-xs capitalize ${STATUS_COLORS[p.status] ?? ""}`}
                >
                  {p.status.replace(/_/g, " ")}
                </Badge>
              </td>
              <td className="px-4 py-2.5 text-right">
                {(p.status === "due" || p.status === "overdue" || p.status === "partially_paid") && (
                  <RecordPaymentDialog
                    paymentRowId={p.id}
                    amountDuePaise={p.amount_due_paise}
                    dueDate={fmt(p.due_date)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
