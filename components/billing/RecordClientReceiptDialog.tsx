"use client";
// Record a payment from a client that isn't tied to any specific invoice
// at the time of entry. Accounts allocates it to invoices later via the
// per-receipt allocation drawer.
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";
import {
  clientReceiptSchema,
  type ClientReceiptFormValues,
} from "@/lib/validations/client-receipt";
import { useRouter } from "next/navigation";

interface Props {
  clients: { id: string; company_name: string }[];
  preselectedClientId?: string;
  triggerLabel?: string;
}

const PAYMENT_MODES = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
];

export function RecordClientReceiptDialog({
  clients,
  preselectedClientId,
  triggerLabel = "Record on-account receipt",
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClientReceiptFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coerce.number shifts input type
    resolver: zodResolver(clientReceiptSchema) as any,
    defaultValues: {
      client_id: preselectedClientId ?? "",
      receipt_date: today,
      payment_mode: "bank_transfer",
      tds_inr: 0,
    },
  });

  function onSubmit(values: ClientReceiptFormValues) {
    startTransition(async () => {
      try {
        const res = await callAction<{ error?: string; id?: string }>(
          "createClientReceipt",
          values,
        );
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success("Receipt recorded — allocate it to invoices from the list.");
        setOpen(false);
        reset({
          client_id: preselectedClientId ?? "",
          receipt_date: today,
          payment_mode: "bank_transfer",
          tds_inr: 0,
        });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record on-account receipt</DialogTitle>
          <DialogDescription>
            Use this when a client pays a round amount against multiple
            invoices (or sends an advance). You can allocate the receipt
            to specific invoices from the list afterwards.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.target as HTMLElement).tagName !== "TEXTAREA"
            ) {
              // Enter inside an input shouldn't submit until the user
              // explicitly clicks Save.
              e.preventDefault();
            }
          }}
          className="space-y-4 py-2"
        >
          <div className="space-y-1.5">
            <Label>
              Client <span className="text-destructive">*</span>
            </Label>
            <select
              {...register("client_id")}
              disabled={!!preselectedClientId}
              className={cn(
                "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                errors.client_id && "border-destructive",
              )}
            >
              <option value="">— Select a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
            {errors.client_id && (
              <p className="text-xs text-destructive">{errors.client_id.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Date <span className="text-destructive">*</span>
              </Label>
              <Input type="date" {...register("receipt_date")} />
              {errors.receipt_date && (
                <p className="text-xs text-destructive">{errors.receipt_date.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 50000"
                {...register("amount_inr", { valueAsNumber: true })}
              />
              {errors.amount_inr && (
                <p className="text-xs text-destructive">{errors.amount_inr.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Payment mode</Label>
              <select
                {...register("payment_mode")}
                className={cn(
                  "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  errors.payment_mode && "border-destructive",
                )}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Reference number</Label>
              <Input placeholder="UTR / UPI txn / cheque #" {...register("reference_number")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Bank name</Label>
              <Input placeholder="HDFC, SBI, ..." {...register("bank_name")} />
            </div>
            <div className="space-y-1.5">
              <Label>TDS deducted (₹)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                {...register("tds_inr", { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tally / external voucher #</Label>
            <Input
              placeholder="e.g. RCT/2026/044"
              maxLength={64}
              {...register("external_reference")}
            />
            <p className="text-xs text-muted-foreground">
              Optional cross-reference so the receipt in the app can be matched to
              the one in your Tally books.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              placeholder="Context, instructions for allocation, etc."
              {...register("notes")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save receipt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
