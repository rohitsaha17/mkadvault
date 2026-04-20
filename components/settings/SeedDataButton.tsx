"use client";
// Seed dummy data button — admin-only. Calls the seedDummyData server action
// and toasts a summary of counts on success.

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { seedDummyData } from "@/app/[locale]/(dashboard)/settings/actions";

export function SeedDataButton() {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await seedDummyData();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const c = result.counts;
      toast.success(
        `Seeded: ${c.sites} sites, ${c.clients} clients, ${c.campaigns} campaigns, ${c.invoices} invoices, ${c.proposals} proposals.`
      );
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        Populate this workspace with realistic sample data across sites, contracts, clients, campaigns,
        invoices, and proposals. Useful for exploring the app. Safe to run once per org.
      </div>
      <Button onClick={handleClick} disabled={isPending} variant="default">
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Seeding…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Load Sample Data
          </>
        )}
      </Button>
    </div>
  );
}
