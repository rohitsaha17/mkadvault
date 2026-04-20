// Root page — redirects straight to /dashboard.
// The proxy (middleware) will redirect unauthenticated users to /login.
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
