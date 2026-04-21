"use client";
// Locale-level error boundary — catches any error thrown inside a page or
// layout under /[locale], including (auth)/* and any render error that
// escapes the (dashboard) boundary (e.g. errors thrown from layout.tsx
// itself, which a page-level error.tsx cannot catch).
//
// Purpose: show the actual error message and digest instead of Next.js's
// opaque "This page couldn't load" fallback, which makes production bugs
// impossible to diagnose.
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to browser console + Vercel runtime logs
    console.error("[locale:error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <div className="mb-3 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="font-semibold">Something went wrong loading this page</h2>
        </div>
        <p className="mb-1 text-muted-foreground">
          The error below is from our server logs. Share it with support if
          the problem keeps happening.
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
              window.location.href = "/login";
            }}
          >
            Go to login
          </Button>
        </div>
      </div>
    </div>
  );
}
