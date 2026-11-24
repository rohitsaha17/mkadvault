// Validation schema for invoice-linked payments (payments_received).
//
// Extracted so the regression tests can import it without pulling the
// Next.js server runtime — same shape as lib/validations/invoice.ts.
import { z } from "zod";

// Coerce cleared number inputs (NaN from valueAsNumber) to 0 so the
// resolver reports "Amount must be positive" instead of Zod's
// "Expected number, received nan" which silently blocks submit.
const paiseAmount = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return 0;
    if (typeof v === "number" && Number.isNaN(v)) return 0;
    return v;
  },
  z.number({ error: "Amount must be a number" }).min(0),
);

export const paymentReceivedSchema = z.object({
  amount_inr: paiseAmount.refine((n) => n > 0, {
    message: "Amount must be positive",
  }),
  // TDS deducted by the payer. Default 0 — reduces invoice balance
  // alongside amount_inr but never leaves the payer's books as cash.
  tds_inr: paiseAmount.default(0),
  payment_date: z.string().min(1, "Payment date required"),
  payment_mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "online"]),
  reference_number: z.string().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
});

export type PaymentReceivedFormValues = z.infer<typeof paymentReceivedSchema>;

// Compute the new balance, amount_paid and status after recording one
// receipt against an invoice. Extracted so the server action and the
// regression tests exercise the same math.
export interface BalanceAfterReceiptInput {
  totalPaise: number;
  previousBalancePaise: number;
  previousAmountPaidPaise: number;
  amountPaise: number;
  tdsPaise: number;
}
export interface BalanceAfterReceipt {
  newBalancePaise: number;
  newAmountPaidPaise: number;
  // "paid" once the remaining balance rounds to within one paisa of
  // zero — covers off-by-one rounding when TDS turns a receipt into a
  // settlement.
  newStatus: "paid" | "partially_paid";
}
export function balanceAfterReceipt(
  input: BalanceAfterReceiptInput,
): BalanceAfterReceipt {
  const effective = input.amountPaise + input.tdsPaise;
  const newBalance = input.previousBalancePaise - effective;
  const newAmountPaid = input.previousAmountPaidPaise + input.amountPaise;
  const newStatus: "paid" | "partially_paid" =
    newBalance <= 1 ? "paid" : "partially_paid";
  return {
    newBalancePaise: Math.max(0, newBalance),
    newAmountPaidPaise: newAmountPaid,
    newStatus,
  };
}
