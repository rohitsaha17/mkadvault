"use client";
// Global error boundary — last-resort catch-all. Fires when an error is
// thrown from the root layout (app/layout.tsx) itself, where Next.js
// cannot render any of our normal layouts because the root html/body
// failed. This is the ONLY way to avoid the "This page couldn't load"
// default for root-level failures.
//
// A global-error must render its own <html> and <body> tags since the
// root layout is not rendered when this boundary fires.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global:error]", error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 0, background: "#0a0a0a", color: "#ededed", minHeight: "100vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
          <div style={{ maxWidth: 560, width: "100%", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", borderRadius: 16, padding: 24 }}>
            <h2 style={{ margin: 0, marginBottom: 12, fontSize: 16, color: "#f87171" }}>
              Something went wrong
            </h2>
            <p style={{ margin: 0, marginBottom: 12, color: "#a3a3a3", fontSize: 13 }}>
              A critical error prevented the app from loading. Share the details below with support.
            </p>
            <pre style={{ whiteSpace: "pre-wrap", background: "#18181b", border: "1px solid #27272a", borderRadius: 8, padding: 12, fontSize: 12, margin: "12px 0", maxHeight: 200, overflow: "auto" }}>
              {error.message}
              {error.digest ? `\n\nDigest: ${error.digest}` : ""}
            </pre>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => reset()}
                style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #3f3f46", background: "#27272a", color: "#ededed", cursor: "pointer", fontSize: 13 }}
              >
                Try again
              </button>
              <button
                onClick={() => {
                  window.location.href = "/login";
                }}
                style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #3f3f46", background: "transparent", color: "#ededed", cursor: "pointer", fontSize: 13 }}
              >
                Go to login
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
