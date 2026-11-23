"use client";
// useNavGuard — blocks accidental navigation / tab close while a
// long-running action is in flight.
//
// The user's main complaint was that creates take 5–30 s on slow links,
// the "Save" click gives weak feedback, and clicking a sidebar link or
// closing the tab mid-way silently discards the record. We can't
// fully intercept Next.js client-side nav (there's no public API in
// Next 16 for that), but we can:
//
//   1. Trigger the browser's native "Changes you made may not be saved"
//      dialog on tab close / reload / hard-refresh via `beforeunload`.
//   2. Intercept browser Back / Forward via `popstate`, re-push the
//      current URL, and show a toast so the user understands why they
//      can't leave yet.
//
// Pass `active: true` for as long as the save is pending. Pass a short
// `message` describing what's being saved so the toast is useful
// ("Saving site…", "Creating campaign…").
import { useEffect } from "react";
import { toast } from "sonner";

export function useNavGuard(active: boolean, message = "A save is still in progress. Please wait for it to finish.") {
  useEffect(() => {
    if (!active) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      // The exact text is ignored by modern browsers (they show a
      // generic message) but we still have to set returnValue AND
      // preventDefault to trigger the dialog in Chrome / Firefox / Safari.
      e.preventDefault();
      e.returnValue = message;
      return message;
    }

    function handlePopState() {
      // The browser has already navigated when popstate fires. Push the
      // URL back so the user stays put.
      window.history.pushState(null, "", window.location.href);
      toast.warning(message);
    }

    // Pin a history entry so Back gets intercepted.
    window.history.pushState(null, "", window.location.href);

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [active, message]);
}
