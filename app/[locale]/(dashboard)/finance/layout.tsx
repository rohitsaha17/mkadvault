// Shell for every page under /finance/*. Fetches the caller's roles
// once so each sub-page can gate finance-only actions consistently, and
// renders the horizontal FinanceNav tab strip above the page content.
import { createClient } from "@/lib/supabase/server";
import { FinanceNav } from "@/components/finance/FinanceNav";
import type { UserRole } from "@/lib/types/database";

const FINANCE_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "manager",
  "accounts",
];

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let canSettle = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, roles")
      .eq("id", user.id)
      .single();
    const rolesArr: UserRole[] =
      Array.isArray(profile?.roles) && profile!.roles!.length > 0
        ? (profile!.roles as UserRole[])
        : profile?.role
        ? [profile.role as UserRole]
        : [];
    canSettle = rolesArr.some((r) => FINANCE_ROLES.includes(r));
  }

  return (
    <div>
      <FinanceNav canSettle={canSettle} />
      {children}
    </div>
  );
}
