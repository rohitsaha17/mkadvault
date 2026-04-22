// Site expense / payment-request catalogs used in forms, filters, and badges.
// Kept together so the UI and DB CHECK constraints stay in sync.

import type {
  ExpenseCategory,
  ExpenseStatus,
  ExpensePayeeType,
  PaymentMode,
} from "@/lib/types/database";

export const EXPENSE_CATEGORIES: {
  value: ExpenseCategory;
  label: string;
  hint?: string;
}[] = [
  { value: "electricity",    label: "Electricity",          hint: "Monthly DISCOM bill for this site" },
  { value: "rent",           label: "Rent / Lease",         hint: "Landowner rent or municipal lease" },
  { value: "maintenance",    label: "Maintenance",          hint: "General upkeep, inspection" },
  { value: "cleaning",       label: "Cleaning",             hint: "Face cleaning, pigeon-proofing" },
  { value: "light_change",   label: "Light change",         hint: "Bulb / tube / LED replacement" },
  { value: "repair",         label: "Repair",               hint: "Structural, panel or wiring repair" },
  { value: "permit_fee",     label: "Permit / Govt fee",    hint: "Municipal / BBMP / KMC fees" },
  { value: "printing",       label: "Printing",             hint: "Flex / vinyl printing charges" },
  { value: "mounting",       label: "Mounting",             hint: "Crane, labour, travel to install" },
  { value: "fuel_transport", label: "Fuel / Transport",     hint: "Field-team travel, vehicle fuel" },
  { value: "other",          label: "Other",                hint: "Describe in the notes field" },
];

export const EXPENSE_STATUSES: {
  value: ExpenseStatus;
  label: string;
  tone: "neutral" | "warning" | "success" | "danger";
}[] = [
  { value: "pending",  label: "Pending",  tone: "warning" },
  { value: "approved", label: "Approved", tone: "neutral" },
  { value: "paid",     label: "Paid",     tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger"  },
];

export const EXPENSE_PAYEE_TYPES: { value: ExpensePayeeType; label: string }[] = [
  { value: "landowner",  label: "Landowner" },
  { value: "agency",     label: "Partner agency" },
  { value: "vendor",     label: "Vendor (printer, electrician, etc.)" },
  { value: "contractor", label: "Contractor / crew" },
  { value: "employee",   label: "Employee reimbursement" },
  { value: "other",      label: "Other" },
];

export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer (NEFT/RTGS/IMPS)" },
  { value: "upi",           label: "UPI" },
  { value: "cheque",        label: "Cheque" },
  { value: "cash",          label: "Cash" },
  { value: "online",        label: "Online (card / netbanking)" },
];

export function expenseCategoryLabel(v: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

export function expenseStatusLabel(v: ExpenseStatus): string {
  return EXPENSE_STATUSES.find((s) => s.value === v)?.label ?? v;
}

export function expensePayeeTypeLabel(v: ExpensePayeeType): string {
  return EXPENSE_PAYEE_TYPES.find((p) => p.value === v)?.label ?? v;
}

export function paymentModeLabel(v: PaymentMode | null | undefined): string {
  if (!v) return "—";
  return PAYMENT_MODES.find((m) => m.value === v)?.label ?? v;
}
