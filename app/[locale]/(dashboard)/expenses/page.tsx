// The /expenses route has been folded into the Finance module —
// payment requests now live at /finance/requests. Redirect any
// bookmarks or in-app links silently so users don't see a 404.
import { redirect } from "next/navigation";

export default function ExpensesRedirect() {
  redirect("/finance/requests");
}
