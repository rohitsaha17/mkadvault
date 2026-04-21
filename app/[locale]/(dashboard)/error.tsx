"use client";
// Dashboard error boundary — catches any server or client error thrown by a
// page inside (dashboard)/ and shows the actual message instead of Vercel's
// opaque "This page couldn't load". This is how we'll see which query is
// failing on prod (e.g. a missing column because a migration wasn't applied).
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console and Vercel logs.
    console.error("[dashboard:error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <div className="mb-3 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="font-semibold">Something went wrong on this page</h2>
        </div>
        <p className="mb-1 text-muted-foreground">
          An error occurred while loading this screen. Share the message below
          with support if it keeps happening.
        </p>
        <pre className="my-3 max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground">
          {error.message}
          {error.digest ? `\n\nDigest: ${error.digest}` : ""}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
