import { redirect } from "next/navigation";

// Redirect /billing → /billing/invoices
export default function BillingPage() {
  redirect("/billing/invoices");
}
