"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inr } from "@/lib/utils";
import { recordPayment } from "@/app/[locale]/(dashboard)/billing/actions";

// Coerce cleared number inputs (NaN from react-hook-form's valueAsNumber)
// to 0 so the user sees "Amount must be positive" instead of Zod's
// "Expected number, received nan" which silently blocks submit.
const amountField = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return 0;
    if (typeof v === "number" && Number.isNaN(v)) return 0;
    return v;
  },
  z.number().positive("Amount must be positive"),
);

const schema = z.object({
  amount_inr: amountField,
  payment_date: z.string().min(1, "Required"),
  payment_mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "online"]),
  reference_number: z.string().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  balanceDuePaise: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecordInvoicePaymentDialog({ invoiceId, invoiceNumber, balanceDuePaise, onClose, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    // Cast: z.preprocess() on amount_inr makes the input type `unknown`,
    // which trips zodResolver's generics. Matches SiteForm / CampaignForm.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      amount_inr: balanceDuePaise / 100,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_mode: "bank_transfer",
    },
  });

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await recordPayment(invoiceId, values);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Payment recorded");
      onSuccess();
      onClose();
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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
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
            <Button type="submit" disabled={isPending} className="flex-1">
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
