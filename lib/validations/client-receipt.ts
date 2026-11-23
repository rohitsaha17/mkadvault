// Validation schema for on-account client receipts.
// On-account means the receipt isn't tied to a specific invoice at the
// time of recording — accounts allocates it to one or more invoices
// later via client_receipt_allocations.
import { z } from "zod";

export const clientReceiptSchema = z.object({
  client_id: z.string().uuid("Select a client"),
  // Accountant's receipt-book number; optional because some orgs don't
  // pre-print books and rely on the system-generated id.
  receipt_number: z.string().max(50).optional(),
  receipt_date: z.string().min(1, "Date is required"), // YYYY-MM-DD
  amount_inr: z.coerce.number().positive("Amount must be greater than zero"),
  payment_mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "online"]),
  reference_number: z.string().max(100).optional(),
  bank_name: z.string().max(100).optional(),
  tds_inr: z.coerce.number().min(0).default(0),
  // Tally voucher number so finance can reconcile across systems.
  external_reference: z.string().max(64).optional(),
  notes: z.string().optional(),
});

export type ClientReceiptFormValues = z.infer<typeof clientReceiptSchema>;

// Schema for allocating a receipt to an invoice. Used by the
// allocate-later flow; multiple allocations per receipt allowed as long
// as their sum stays below the receipt amount.
export const clientReceiptAllocationSchema = z.object({
  client_receipt_id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  amount_inr: z.coerce.number().positive("Amount must be greater than zero"),
  notes: z.string().optional(),
});

export type ClientReceiptAllocationValues = z.infer<typeof clientReceiptAllocationSchema>;
