"use client";
// Full-featured editor for a team member. Replaces the old inline
// RolePicker + Deactivate button combo. Accessible via an "Edit" button
// on each row in the members list.
//
// Sections:
//   1. Profile   — full_name, phone
//   2. Role(s)   — same toggle rules as the invite form / RolePicker
//   3. Access    — activate / deactivate
//   4. Password  — admins can set a new password for the user
//   5. Danger    — permanent delete (confirmed)
//
// Each section has its own Save button because the actions hit different
// endpoints and failure modes are independent (e.g. setting a password
// shouldn't silently roll back a role change).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Loader2,
  X,
  Check,
  User as UserIcon,
  ShieldCheck,
  KeyRound,
  UserX,
  UserCheck,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateUserRoles,
  setUserActive,
  setUserPassword,
  updateUserProfile,
  deleteUser,
} from "@/app/[locale]/(dashboard)/settings/users/actions";
import type { UserRole } from "@/lib/types/database";
import type { TeamMember } from "@/app/[locale]/(dashboard)/settings/users/page";

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super Admin", description: "Full access including billing" },
  { value: "admin",       label: "Admin",       description: "Manage team, settings, everything" },
  { value: "manager",     label: "Manager",     description: "Sales, operations & accounts — cannot change settings" },
  { value: "executive",   label: "Executive",   description: "Sales + operations: clients, campaigns, sites, mounting" },
  { value: "accounts",    label: "Accountant",  description: "Billing, payments, aging, reports" },
  { value: "viewer",      label: "Viewer",      description: "Read-only access" },
];

const COMBINABLE = new Set<UserRole>(["executive", "accounts"]);

// Mirrors the rules in UsersManagement.tsx so the behaviour is identical.
function toggleRole(current: UserRole[], clicked: UserRole): UserRole[] {
  if (!COMBINABLE.has(clicked)) return [clicked];
  if (current.some((r) => !COMBINABLE.has(r))) return [clicked];
  const alreadyIn = current.includes(clicked);
  const next = alreadyIn
    ? current.filter((r) => r !== clicked)
    : [...current, clicked];
  return next.length === 0 ? [clicked] : next;
}

interface Props {
  member: TeamMember;
  isSelf: boolean;
  onClose: () => void;
  // Called with the updated fields so the parent list can patch its local
  // state without a full router.refresh().
  onPatched: (patch: Partial<TeamMember>) => void;
  // Called after a successful delete so the parent can drop the row.
  onDeleted: () => void;
}

export function EditUserDialog({
  member,
  isSelf,
  onClose,
  onPatched,
  onDeleted,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [busySection, setBusySection] = useState<string | null>(null);

  // Profile state
  const [fullName, setFullName] = useState(member.full_name ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");

  // Roles state
  const initialRoles = member.roles && member.roles.length > 0 ? member.roles : [member.role];
  const [roles, setRoles] = useState<UserRole[]>(initialRoles);

  // Password state
  const [newPassword, setNewPassword] = useState("");

  function run(section: string, fn: () => Promise<unknown>) {
    setBusySection(section);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        // Belt-and-braces: every server action in this app returns `{ error }`
        // on failure and never throws, but if one ever does, we surface a
        // toast here instead of letting it bubble to the error boundary.
        // The specific "An unexpected response was received from the server"
        // error comes from React's action-response parser when the response
        // body isn't a valid RSC stream — the action itself almost certainly
        // succeeded. Treat it as a "likely-succeeded, please reload" case
        // rather than an error.
        console.error(`[EditUserDialog:${section}] unexpected error:`, err);
        const msg = err instanceof Error ? err.message : "";
        if (/unexpected response was received/i.test(msg)) {
          toast.message(
            "Change likely saved — reload the page to confirm.",
          );
        } else {
          toast.error(msg || "Something went wrong. Try again.");
        }
      } finally {
        setBusySection(null);
      }
    });
  }

  function handleSaveProfile() {
    const name = fullName.trim();
    if (!name) {
      toast.error("Full name cannot be empty");
      return;
    }
    run("profile", async () => {
      const res = await updateUserProfile(member.id, {
        full_name: name,
        phone: phone.trim() || null,
      });
      if (res.error) return toast.error(res.error);
      toast.success("Profile updated");
      onPatched({ full_name: name, phone: phone.trim() || null });
    });
  }

  function handleSaveRoles() {
    if (roles.length === 0) {
      toast.error("Pick at least one role");
      return;
    }
    run("roles", async () => {
      const res = await updateUserRoles(member.id, roles);
      if (res.error) return toast.error(res.error);
      toast.success("Role updated");
      onPatched({ role: roles[0], roles });
    });
  }

  function handleToggleActive() {
    if (isSelf) return;
    run("active", async () => {
      const res = await setUserActive(member.id, !member.is_active);
      if (res.error) return toast.error(res.error);
      toast.success(member.is_active ? "User deactivated" : "User reactivated");
      onPatched({ is_active: !member.is_active });
    });
  }

  function handleSetPassword() {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    run("password", async () => {
      const res = await setUserPassword(member.id, newPassword);
      if (res.error) return toast.error(res.error);
      toast.success("Password updated — share it with the user securely");
      setNewPassword("");
    });
  }

  function handleDelete() {
    if (isSelf) return;
    const label = member.full_name || member.email || "this user";
    const ok = window.confirm(
      `Permanently delete ${label}?\n\nThis cannot be undone. Their login, profile, and access will be removed immediately.`,
    );
    if (!ok) return;
    run("delete", async () => {
      const res = await deleteUser(member.id);
      if (res.error) return toast.error(res.error);
      toast.success(`${label} deleted`);
      onDeleted();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl my-8 rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">
              Edit {member.full_name || member.email || "user"}
            </h2>
            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5 space-y-6 text-sm">
          {/* ─── Profile ───────────────────────────────────────────── */}
          <Section icon={<UserIcon className="h-4 w-4" />} title="Profile">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Full name</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Priya Sharma"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98XXXXXXXX"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <SaveButton
                busy={busySection === "profile"}
                onClick={handleSaveProfile}
                disabled={isPending && busySection !== "profile"}
              >
                Save profile
              </SaveButton>
            </div>
          </Section>

          {/* ─── Roles ─────────────────────────────────────────────── */}
          <Section icon={<ShieldCheck className="h-4 w-4" />} title="Roles">
            <p className="mb-2 text-xs text-muted-foreground">
              Pick a single role, or assign both Executive + Accountant together.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ROLES.map((r) => {
                const checked = roles.includes(r.value);
                return (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setRoles((prev) => toggleRole(prev, r.value))}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                      checked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-foreground">
                        {r.label}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {r.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end">
              <SaveButton
                busy={busySection === "roles"}
                onClick={handleSaveRoles}
                disabled={isPending && busySection !== "roles"}
              >
                Save roles
              </SaveButton>
            </div>
          </Section>

          {/* ─── Access (active toggle) ────────────────────────────── */}
          {!isSelf && (
            <Section
              icon={member.is_active ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
              title="Access"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {member.is_active ? "Active" : "Deactivated"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {member.is_active
                      ? "User can sign in and access the app."
                      : "User cannot sign in."}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleToggleActive}
                  disabled={isPending}
                >
                  {busySection === "active" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : member.is_active ? (
                    <>
                      <UserX className="h-3.5 w-3.5" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-3.5 w-3.5" />
                      Reactivate
                    </>
                  )}
                </Button>
              </div>
            </Section>
          )}

          {/* ─── Password ──────────────────────────────────────────── */}
          <Section icon={<KeyRound className="h-4 w-4" />} title="Set new password">
            <p className="mb-2 text-xs text-muted-foreground">
              Directly set a new password for this user. Share it with them over a
              secure channel and ask them to change it on first login.
            </p>
            <div className="flex items-stretch gap-2">
              <Input
                type="text"
                autoComplete="off"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="flex-1"
              />
              <SaveButton
                busy={busySection === "password"}
                onClick={handleSetPassword}
                disabled={(isPending && busySection !== "password") || newPassword.length < 8}
              >
                Update password
              </SaveButton>
            </div>
          </Section>

          {/* ─── Danger zone — delete ──────────────────────────────── */}
          {!isSelf && (
            <Section
              icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
              title="Danger zone"
              tone="danger"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Delete user</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently remove this user. This cannot be undone.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={handleDelete}
                  disabled={isPending}
                >
                  {busySection === "delete" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </Button>
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${
        tone === "danger"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-muted/20"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function SaveButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" size="sm" onClick={onClick} disabled={disabled || busy}>
      {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
      {children}
    </Button>
  );
}
