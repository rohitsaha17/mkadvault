"use client";
// Team members management — invite form + table with role editor and
// activate/deactivate controls. Admin-only (the parent page enforces this).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, UserPlus, ShieldCheck, UserX, UserCheck, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inviteUser,
  updateUserRole,
  setUserActive,
  resendInvite,
} from "@/app/[locale]/(dashboard)/settings/users/actions";
import type { UserRole } from "@/lib/types/database";
import type { TeamMember } from "@/app/[locale]/(dashboard)/settings/users/page";

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "super_admin",        label: "Super Admin",        description: "Full access including billing" },
  { value: "admin",              label: "Admin",              description: "Manage team, settings, everything" },
  { value: "sales_manager",      label: "Sales Manager",      description: "Clients, campaigns, proposals" },
  { value: "operations_manager", label: "Operations Manager", description: "Sites, mounting, creatives" },
  { value: "accounts",           label: "Accounts",           description: "Billing, payments, reports" },
  { value: "viewer",             label: "Viewer",             description: "Read-only access" },
];

const ROLE_TONES: Record<UserRole, string> = {
  super_admin:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  admin:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  sales_manager:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  operations_manager:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  accounts:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  viewer:
    "bg-muted text-muted-foreground border-border dark:bg-white/5 dark:text-muted-foreground dark:border-white/10",
};

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  sales_manager: "Sales Manager",
  operations_manager: "Operations Manager",
  accounts: "Accounts",
  viewer: "Viewer",
};

interface Props {
  members: TeamMember[];
  currentUserId: string;
}

export function UsersManagement({ members: initialMembers, currentUserId }: Props) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Invite form state
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const [showInvite, setShowInvite] = useState(false);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !fullName.trim()) {
      toast.error("Email and full name are required");
      return;
    }
    startTransition(async () => {
      const res = await inviteUser({ email: email.trim(), full_name: fullName.trim(), role });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Invite sent to ${email}`);
      setEmail("");
      setFullName("");
      setRole("viewer");
      setShowInvite(false);
      // Optimistic — the server revalidates, and the page will refetch on nav;
      // for immediate feedback, add a placeholder row
      setMembers((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`,
          full_name: fullName.trim(),
          email: email.trim(),
          role,
          is_active: true,
          phone: null,
          last_sign_in_at: null,
          created_at: new Date().toISOString(),
        },
      ]);
    });
  }

  function handleRoleChange(userId: string, newRole: UserRole) {
    setBusyId(userId);
    startTransition(async () => {
      const res = await updateUserRole(userId, newRole);
      setBusyId(null);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Role updated");
      setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, role: newRole } : m)));
    });
  }

  function handleToggleActive(member: TeamMember) {
    setBusyId(member.id);
    startTransition(async () => {
      const res = await setUserActive(member.id, !member.is_active);
      setBusyId(null);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(member.is_active ? "User deactivated" : "User reactivated");
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, is_active: !m.is_active } : m))
      );
    });
  }

  function handleResend(member: TeamMember) {
    if (!member.email) return;
    setBusyId(member.id);
    startTransition(async () => {
      const res = await resendInvite(member.email!);
      setBusyId(null);
      if (res.error) toast.error(res.error);
      else toast.success(`Invite resent to ${member.email}`);
    });
  }

  return (
    <div className="space-y-6">
      {/* Invite card */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-6">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Invite a new user</h2>
          </div>
          {!showInvite && (
            <Button size="sm" onClick={() => setShowInvite(true)} className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              Invite user
            </Button>
          )}
        </div>

        {showInvite ? (
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Full Name</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Priya Sharma"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="priya@yourcompany.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Role</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {ROLES.map((r) => (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setRole(r.value)}
                    className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                      role === r.value
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send invite
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowInvite(false);
                  setEmail("");
                  setFullName("");
                  setRole("viewer");
                }}
              >
                Cancel
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              An email with a sign-in link will be sent. The user will be added to your organization
              as soon as they accept.
            </p>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click <span className="font-medium text-foreground">Invite user</span> to add a new team member.
          </p>
        )}
      </section>

      {/* Members list */}
      <section className="rounded-2xl border border-border bg-card card-elevated overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Members <span className="text-muted-foreground">({members.length})</span>
          </h2>
        </div>

        <div className="divide-y divide-border">
          {members.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No team members yet. Invite your first user above.
            </div>
          ) : (
            members.map((m) => {
              const isSelf = m.id === currentUserId;
              const isPendingRow = m.id.startsWith("pending-");
              const busy = busyId === m.id;

              return (
                <div
                  key={m.id}
                  className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:gap-4"
                >
                  {/* Avatar + name + email */}
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-sm font-semibold text-foreground ring-1 ring-inset ring-border">
                      {(m.full_name ?? m.email ?? "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">
                          {m.full_name || m.email || "Unnamed"}
                        </p>
                        {isSelf && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            You
                          </span>
                        )}
                        {isPendingRow && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 px-1.5 py-0.5 rounded-full">
                            Pending
                          </span>
                        )}
                        {!m.is_active && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{m.email ?? "—"}</p>
                    </div>
                  </div>

                  {/* Role badge + selector */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`hidden md:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${ROLE_TONES[m.role]}`}
                    >
                      {ROLE_LABEL[m.role]}
                    </span>
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value as UserRole)}
                      disabled={busy || isPendingRow}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Last sign in */}
                  <div className="hidden lg:block text-right shrink-0 w-32">
                    <p className="text-xs text-muted-foreground">
                      {m.last_sign_in_at
                        ? format(new Date(m.last_sign_in_at), "dd MMM yyyy")
                        : "Never signed in"}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {m.last_sign_in_at == null && m.email && !isPendingRow && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => handleResend(m)}
                        disabled={busy}
                      >
                        Resend invite
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      onClick={() => handleToggleActive(m)}
                      disabled={busy || isSelf || isPendingRow}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : m.is_active ? (
                        <>
                          <UserX className="h-3 w-3" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-3 w-3" />
                          Reactivate
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
