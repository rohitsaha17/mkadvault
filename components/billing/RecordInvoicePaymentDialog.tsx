"use client";
import { useState, useTransition } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { showFirstFormError } from "@/lib/utils/form-feedback";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inr } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import {
  paymentReceivedSchema,
  type PaymentReceivedFormValues,
} from "@/lib/validations/payment-received";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  balanceDuePaise: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecordInvoicePaymentDialog({ invoiceId, invoiceNumber, balanceDuePaise, onClose, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  // Surface server-side / DB errors inside the dialog as a red banner
  // rather than only as a toast — the toast gets missed when the user
  // is reading the form and reaches for the submit button again.
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, setFocus, watch, formState: { errors } } =
    useForm<PaymentReceivedFormValues>({
    // Cast: z.preprocess() on amount_inr makes the input type `unknown`,
    // which trips zodResolver's generics. Matches SiteForm / CampaignForm.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(paymentReceivedSchema) as any,
    defaultValues: {
      amount_inr: balanceDuePaise / 100,
      tds_inr: 0,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_mode: "bank_transfer",
    },
  });

  // Live breakdown so the user can see the balance landing at zero
  // once (amount + TDS) equals the outstanding figure.
  const watchedAmount = watch("amount_inr");
  const watchedTds = watch("tds_inr");
  const effectivePaise =
    Math.round(((Number(watchedAmount) || 0) + (Number(watchedTds) || 0)) * 100);
  const remainingPaise = Math.max(0, balanceDuePaise - effectivePaise);
  const overshoot = effectivePaise > balanceDuePaise + 1;

  function onSubmit(values: PaymentReceivedFormValues) {
    setServerError(null);
    const clean = sanitizeForTransport(values);
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "recordInvoicePayment",
          invoiceId,
          clean,
        );
        if (result.error) {
          setServerError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success("Payment recorded");
        onSuccess();
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        setServerError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Record Payment</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          Invoice <strong>{invoiceNumber}</strong> · Balance due: <strong>{inr(balanceDuePaise)}</strong>
        </p>

        {serverError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-medium">Couldn&rsquo;t save payment</p>
              <p className="text-xs">{serverError}</p>
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit(onSubmit, (errs: FieldErrors<PaymentReceivedFormValues>) =>
            showFirstFormError(errs, { setFocus, label: "RecordInvoicePaymentDialog" }),
          )}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount Received (₹) *</Label>
              <Input
                {...register("amount_inr", { valueAsNumber: true })}
                type="number"
                step="0.01"
              />
              {errors.amount_inr && <p className="text-xs text-red-500">{errors.amount_inr.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>TDS Deducted (₹)</Label>
              <Input
                {...register("tds_inr", { valueAsNumber: true })}
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
              />
              {errors.tds_inr && <p className="text-xs text-red-500">{errors.tds_inr.message}</p>}
            </div>
          </div>

          {/* Running breakdown — amount + TDS sits against the invoice
              balance so it's obvious when a receipt settles the bill. */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between tabular-nums">
              <span>Amount + TDS</span>
              <span className="font-medium text-foreground">{inr(effectivePaise)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between tabular-nums">
              <span>After this receipt</span>
              <span
                className={
                  overshoot
                    ? "font-medium text-destructive"
                    : "font-medium text-foreground"
                }
              >
                {overshoot ? "Exceeds balance" : inr(remainingPaise)}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Payment Date *</Label>
            <Input {...register("payment_date")} type="date" />
            {errors.payment_date && <p className="text-xs text-red-500">{errors.payment_date.message}</p>}
          </div>

          <div className="space-y-1">
            <Label>Payment Mode *</Label>
            <select
              {...register("payment_mode")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="bank_transfer">Bank Transfer / NEFT / RTGS</option>
              <option value="upi">UPI</option>
              <option value="online">Online</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Reference / Cheque No.</Label>
              <Input {...register("reference_number")} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Bank Name</Label>
              <Input {...register("bank_name")} placeholder="Optional" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Input {...register("notes")} placeholder="Optional" />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending || overshoot} className="flex-1">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record Payment
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
