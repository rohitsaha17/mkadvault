"use client";
// Registers the service worker once per session, after hydration.
// Mounted from the dashboard layout (any client component rendered
// inside it works — we picked the layout because it's loaded on
// every authenticated page, which is where install prompts make
// sense).
//
// Bail on unsupported browsers / dev mode if anything goes wrong —
// SW registration failures should never block the app from rendering.

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Skip in dev: HMR + a SW caching layer would fight each other
    // and confuse "why is my edit not showing up" debugging. Vercel
    // sets NODE_ENV=production so prod registration still happens.
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        // Worth logging but never throw — install criteria is the only
        // thing this enables and a missing SW just means the user has
        // to use "Add to Home Screen" manually.
        console.warn("[pwa] service worker registration failed:", err);
      });
  }, []);

  return null;
}
