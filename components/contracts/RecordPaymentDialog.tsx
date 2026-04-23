"use client";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { recordPaymentSchema, type RecordPaymentValues } from "@/lib/validations/contract";
import { recordPayment } from "@/app/[locale]/(dashboard)/contracts/actions";
import { sanitizeForTransport } from "@/lib/utils/sanitize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, inr } from "@/lib/utils";

interface Props {
  paymentRowId: string;
  amountDuePaise: number;
  dueDate: string;
  onSuccess?: () => void;
}

// Simple modal implementation without shadcn Dialog to avoid dependency issues
export function RecordPaymentDialog({ paymentRowId, amountDuePaise, dueDate, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RecordPaymentValues>({
    // Cast: z.preprocess() on amount_paid_inr / tds_percentage makes zod's
    // input type `unknown`, which trips zodResolver's generics.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(recordPaymentSchema) as any,
    defaultValues: {
      amount_paid_inr: amountDuePaise / 100,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_mode: "bank_transfer",
    },
  });

  function onSubmit(values: RecordPaymentValues) {
    const clean = sanitizeForTransport(values);
    startTransition(async () => {
      try {
        const result = await recordPayment(paymentRowId, amountDuePaise, clean);
        if (result.error) { toast.error(result.error); return; }
        toast.success("Payment recorded");
        setOpen(false);
        reset();
        onSuccess?.();
        window.location.reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record Payment
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          {/* Modal */}
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Record Payment</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Due: {dueDate} · Amount due: {inr(amountDuePaise)}
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Amount Paid (₹)<span className="text-red-500 ml-0.5">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...register("amount_paid_inr", { valueAsNumber: true })}
                  className={cn(errors.amount_paid_inr && "border-red-400")}
                />
                {errors.amount_paid_inr && (
                  <p className="text-xs text-red-500">{errors.amount_paid_inr.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Payment Date<span className="text-red-500 ml-0.5">*</span></Label>
                  <Input
                    type="date"
                    {...register("payment_date")}
                    className={cn(errors.payment_date && "border-red-400")}
                  />
                  {errors.payment_date && (
                    <p className="text-xs text-red-500">{errors.payment_date.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Payment Mode<span className="text-red-500 ml-0.5">*</span></Label>
                  <select
                    {...register("payment_mode")}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="upi">UPI</option>
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Reference / UTR Number</Label>
                <Input
                  {...register("payment_reference")}
                  placeholder="Transaction ID or cheque number"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>TDS %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="30"
                    {...register("tds_percentage", { valueAsNumber: true })}
                    placeholder="e.g. 10"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea {...register("notes")} placeholder="Optional notes" rows={2} />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isPending} className="flex-1">
                  {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Payment
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setOpen(false); reset(); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
