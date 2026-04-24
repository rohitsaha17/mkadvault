"use client";
// Shared expense table. Used on:
//   - /expenses (org-wide)
//   - site detail page (site-scoped)
//
// Each row shows category, description, amount, payee, site, status + age.
// Finance roles get a "Mark paid" button for pending/approved rows, plus
// approve/reject quick actions. Everyone else sees the badge only.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTransition, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MarkPaidDialog } from "./MarkPaidDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { inr, fmt, cn } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";
import {
  expenseCategoryLabel,
  paymentModeLabel,
} from "@/lib/constants/expenses";
import type {
  ExpenseStatus,
  ExpenseCategory,
  PaymentMode,
} from "@/lib/types/database";

export interface ExpenseRow {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount_paise: number;
  status: ExpenseStatus;
  payee_name: string;
  payee_type: string;
  needed_by: string | null;
  paid_at: string | null;
  payment_mode: PaymentMode | null;
  receipt_doc_urls: string[] | null;
  payment_proof_urls: string[] | null;
  created_at: string;
  site: { id: string; name: string; site_code: string | null } | null;
}

interface Props {
  expenses: ExpenseRow[];
  canSettle: boolean;
  // If true, the Site column is hidden (used on site detail page).
  hideSiteColumn?: boolean;
  emptyMessage?: string;
}

export function ExpensesList({
  expenses,
  canSettle,
  hideSiteColumn,
  emptyMessage = "No payment requests yet.",
}: Props) {
  const router = useRouter();

  if (expenses.length === 0) {
    return (
      <EmptyState
        variant="card"
        title={emptyMessage}
        description="Create a payment request to track an expense here."
      />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card card-elevated overflow-hidden overflow-x-auto">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            {!hideSiteColumn && <TableHead>Site</TableHead>}
            <TableHead>Payee</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="max-w-[280px]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {e.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.needed_by
                      ? `Needed by ${fmt(e.needed_by)}`
                      : `Added ${fmt(e.created_at)}`}
                    {(e.receipt_doc_urls?.length ?? 0) +
                      (e.payment_proof_urls?.length ?? 0) >
                      0 && (
                      <span className="ml-2 inline-flex items-center gap-0.5 text-[11px]">
                        <Paperclip className="h-3 w-3" />
                        {(e.receipt_doc_urls?.length ?? 0) +
                          (e.payment_proof_urls?.length ?? 0)}
                      </span>
                    )}
                  </p>
                </div>
              </TableCell>
              <TableCell className="text-xs">
                {expenseCategoryLabel(e.category)}
              </TableCell>
              {!hideSiteColumn && (
                <TableCell className="text-xs text-muted-foreground">
                  {e.site ? (
                    <Link
                      href={`/sites/${e.site.id}`}
                      className="hover:text-primary transition-colors"
                    >
                      {e.site.name}
                      {e.site.site_code && (
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">
                          {e.site.site_code}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/60">Overhead</span>
                  )}
                </TableCell>
              )}
              <TableCell className="text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {e.payee_name}
                  </p>
                  <p className="capitalize text-muted-foreground">
                    {e.payee_type}
                  </p>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {inr(e.amount_paise)}
                {e.status === "paid" && e.payment_mode && (
                  <p className="text-[10px] text-muted-foreground font-normal">
                    via {paymentModeLabel(e.payment_mode).split(" ")[0]}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={e.status} />
              </TableCell>
              <TableCell>
                <ExpenseRowActions
                  expense={e}
                  canSettle={canSettle}
                  onChange={() => router.refresh()}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ExpenseRowActions({
  expense,
  canSettle,
  onChange,
}: {
  expense: ExpenseRow;
  canSettle: boolean;
  onChange: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function doSetStatus(status: "pending" | "approved" | "rejected") {
    startTransition(async () => {
      try {
        const res = await callAction<{ error?: string }>("setExpenseStatus", {
          expense_id: expense.id,
          status,
        });
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(status === "approved" ? "Approved" : "Updated");
        onChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  function doDelete() {
    startTransition(async () => {
      try {
        const res = await callAction<{ error?: string }>("deleteExpense", expense.id);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success("Removed");
        setConfirmingDelete(false);
        onChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  const isSettleable =
    canSettle && (expense.status === "pending" || expense.status === "approved");
  const canDelete = expense.status !== "paid";

  return (
    <div className="flex items-center justify-end gap-1">
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

      {isSettleable && (
        <MarkPaidDialog
          expenseId={expense.id}
          amountPaise={expense.amount_paise}
          payeeName={expense.payee_name}
          onSuccess={onChange}
        />
      )}

      {canSettle && expense.status === "pending" && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Approve"
          title="Approve"
          onClick={() => doSetStatus("approved")}
          disabled={isPending}
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        </Button>
      )}

      {canSettle && expense.status !== "paid" && expense.status !== "rejected" && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Reject"
          title="Reject"
          onClick={() => doSetStatus("rejected")}
          disabled={isPending}
        >
          <XCircle className="h-3.5 w-3.5 text-rose-600" />
        </Button>
      )}

      {canDelete && (
        confirmingDelete ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              onClick={doDelete}
              disabled={isPending}
              className={cn("h-7 px-2 text-[11px]")}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
              disabled={isPending}
              className="h-7 px-2 text-[11px]"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Delete"
            title="Delete"
            onClick={() => setConfirmingDelete(true)}
            disabled={isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )
      )}
    </div>
  );
}
