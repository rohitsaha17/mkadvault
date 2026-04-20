// Setup page — one-time initial configuration for a fresh deployment.
// Creates the first organisation and super_admin account.
// Permanently locked after the first setup completes.
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { SetupForm } from "./SetupForm";

export const metadata = {
  title: "Initial Setup — OOH Platform",
};

export default async function SetupPage() {
  const admin = createAdminClient();

  // Check if setup has already been completed
  const { count } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true });

  // If an organisation already exists, setup is done — go to login
  if (count && count > 0) {
    redirect("/login");
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-card/60 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="h-6 w-6 text-white" />
        </div>
        <h2 className="text-xl font-semibold text-white">Welcome! Let&apos;s get started.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up your organisation and create your admin account.
        </p>
      </div>

      <SetupForm />
    </div>
  );
}
