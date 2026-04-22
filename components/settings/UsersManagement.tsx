"use client";
// Team members management — invite form + table with multi-select role editor
// and activate/deactivate controls. Admin-only (parent page enforces this).
//
// Role model:
//   * Single-select roles: super_admin, admin, executive, accounts, viewer
//   * Multi-select combo:  {executive, accounts} — a user can hold both
//   * No other multi combos are allowed (DB has a matching CHECK in migration 020)

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Loader2,
  UserPlus,
  ShieldCheck,
  Mail,
  Check,
  Pencil,
} from "lucide-react";
import { EditUserDialog } from "@/components/settings/EditUserDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inviteUser,
  resendInvite,
} from "@/app/[locale]/(dashboard)/settings/users/actions";
import type { UserRole } from "@/lib/types/database";
import type { TeamMember } from "@/app/[locale]/(dashboard)/settings/users/page";

// ─── Role catalog ─────────────────────────────────────────────────────────────
const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super Admin", description: "Full access including billing" },
  { value: "admin",       label: "Admin",       description: "Manage team, settings, everything" },
  { value: "manager",     label: "Manager",     description: "Sales, operations & accounts — cannot change settings" },
  { value: "executive",   label: "Executive",   description: "Sales + operations: clients, campaigns, sites, mounting" },
  { value: "accounts",    label: "Accountant",  description: "Billing, payments, aging, reports" },
  { value: "viewer",      label: "Viewer",      description: "Read-only access" },
];

// Which roles can be combined with another. Today only executive + accounts.
const COMBINABLE = new Set<UserRole>(["executive", "accounts"]);

const ROLE_TONES: Record<UserRole, string> = {
  super_admin:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  admin:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  manager:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  executive:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  accounts:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  viewer:
    "bg-muted text-muted-foreground border-border dark:bg-white/5 dark:text-muted-foreground dark:border-white/10",
};

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  executive: "Executive",
  accounts: "Accountant",
  viewer: "Viewer",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Toggle a role in the current selection. Rules:
//   * If the clicked role is NOT combinable, it becomes the only selection.
//   * If the clicked role IS combinable and you're adding it to a non-combo
//     selection, it replaces the current selection.
//   * If both clicked and currently-selected roles are combinable, the
//     clicked role is toggled (added or removed) — producing either a
//     single-role selection or the {executive, accounts} pair.
function toggleRole(current: UserRole[], clicked: UserRole): UserRole[] {
  // Non-combinable always wins and clears the rest.
  if (!COMBINABLE.has(clicked)) return [clicked];

  // Clicked is combinable. If current selection has non-combinable roles,
  // replace everything with just the clicked role.
  if (current.some((r) => !COMBINABLE.has(r))) return [clicked];

  // Both combinable — toggle the clicked one in/out.
  const alreadyIn = current.includes(clicked);
  const next = alreadyIn
    ? current.filter((r) => r !== clicked)
    : [...current, clicked];

  // Never allow empty — if user just deselected the only role, fall back to the click.
  return next.length === 0 ? [clicked] : next;
}

function rolesToSortedLabel(roles: UserRole[]): string {
  return roles.map((r) => ROLE_LABEL[r]).join(" + ");
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  members: TeamMember[];
  currentUserId: string;
}

export function UsersManagement({ members: initialMembers, currentUserId }: Props) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Invite form state
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>(["viewer"]);
  const [showInvite, setShowInvite] = useState(false);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !fullName.trim()) {
      toast.error("Email and full name are required");
      return;
    }
    if (selectedRoles.length === 0) {
      toast.error("Pick at least one role");
      return;
    }
    startTransition(async () => {
      const res = await inviteUser({
        email: email.trim(),
        full_name: fullName.trim(),
        roles: selectedRoles,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Invite sent to ${email}`);
      setEmail("");
      setFullName("");
      setSelectedRoles(["viewer"]);
      setShowInvite(false);
      setMembers((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`,
          full_name: fullName.trim(),
          email: email.trim(),
          role: selectedRoles[0],
          roles: selectedRoles,
          is_active: true,
          phone: null,
          last_sign_in_at: null,
          created_at: new Date().toISOString(),
        },
      ]);
    });
  }

  // Patch a member in-place after EditUserDialog saves a field.
  function patchMember(id: string, patch: Partial<TeamMember>) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
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
      {/* ── Invite card ──────────────────────────────────────────────────── */}
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
              <p className="text-xs text-muted-foreground">
                Pick a single role, or assign both <span className="font-medium text-foreground">Executive</span> and{" "}
                <span className="font-medium text-foreground">Accountant</span> together for users who handle
                both operations and finance.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {ROLES.map((r) => {
                  const isSelected = selectedRoles.includes(r.value);
                  const isCombinable = COMBINABLE.has(r.value);
                  return (
                    <button
                      type="button"
                      key={r.value}
                      onClick={() => setSelectedRoles((prev) => toggleRole(prev, r.value))}
                      className={`relative flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-sm font-medium text-foreground flex-1">
                          {r.label}
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </div>
                      <span className="text-xs text-muted-foreground">{r.description}</span>
                      {isCombinable && (
                        <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Combinable
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedRoles.length > 1 && (
                <p className="text-xs text-primary">
                  Selected combo: {rolesToSortedLabel(selectedRoles)}
                </p>
              )}
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
                  setSelectedRoles(["viewer"]);
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

      {/* ── Members list ─────────────────────────────────────────────────── */}
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
              const memberRoles = m.roles && m.roles.length > 0 ? m.roles : [m.role];

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

                  {/* Role badges (read-only — edit via the Edit dialog) */}
                  <div className="flex flex-wrap items-center gap-1 shrink-0 min-h-6">
                    {memberRoles.map((r) => (
                      <span
                        key={r}
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${ROLE_TONES[r as UserRole]}`}
                      >
                        {ROLE_LABEL[r as UserRole]}
                      </span>
                    ))}
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
                      onClick={() => setEditingId(m.id)}
                      disabled={isPendingRow}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Edit dialog — one at a time */}
      {editingId &&
        (() => {
          const editing = members.find((x) => x.id === editingId);
          if (!editing) return null;
          return (
            <EditUserDialog
              member={editing}
              isSelf={editing.id === currentUserId}
              onClose={() => setEditingId(null)}
              onPatched={(patch) => patchMember(editing.id, patch)}
              onDeleted={() => {
                setMembers((prev) => prev.filter((x) => x.id !== editing.id));
                setEditingId(null);
              }}
            />
          );
        })()}
    </div>
  );
}

