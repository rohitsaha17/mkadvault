"use client";
// Small in-app "Install" button. On Android Chrome / desktop Chromium
// the browser fires `beforeinstallprompt` once the page satisfies
// install criteria (manifest + service worker + https). We stash that
// event and replay it when the user clicks the button — same UX as
// Chrome's address-bar install icon, but discoverable from inside
// the app.
//
// On iOS Safari the event never fires (Apple's policy: Add-to-Home-Screen
// has to be initiated from the share sheet). We render an iOS hint
// the first time an iOS user lands on the page so they know the
// feature exists.
//
// Hides itself once the app is already installed (display-mode:
// standalone) so we don't nag users who already have the icon.

import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Chrome's prompt event isn't in lib.dom yet — declare the shape we
// rely on locally so the rest of the component stays typed.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

// Per-device "I dismissed the hint" memory so we don't keep nagging.
const IOS_HINT_DISMISSED_KEY = "pwa-ios-hint-dismissed";

export function InstallButton() {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed — display-mode media query flips to standalone
    // when launched from the home-screen icon. Hide entirely in that
    // case so the button doesn't say "Install" inside the installed
    // app.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // Safari's pre-PWA hint for the same thing
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setHidden(true);
      return;
    }

    // Detect iOS so we can show the Share-sheet hint, since
    // beforeinstallprompt never fires on iOS Safari.
    const ua = navigator.userAgent || "";
    const isIos = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos) {
      const dismissed =
        typeof localStorage !== "undefined" &&
        localStorage.getItem(IOS_HINT_DISMISSED_KEY) === "1";
      if (!dismissed) setShowIosHint(true);
    }

    function onBeforePrompt(e: Event) {
      // Stop Chrome from showing its own banner — we render our own
      // button so the install flow is discoverable from inside the app.
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    }

    function onInstalled() {
      // User completed the install — hide our button so it doesn't
      // linger after the fact.
      setPromptEvent(null);
      setHidden(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforePrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforePrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setPromptEvent(null);
    }
  }

  function dismissIosHint() {
    setShowIosHint(false);
    try {
      localStorage.setItem(IOS_HINT_DISMISSED_KEY, "1");
    } catch {
      // localStorage disabled / private mode — fine, the hint will
      // reappear next visit. Not worth a fallback.
    }
  }

  if (hidden) return null;

  // Chrome-style flow — we have a stashed beforeinstallprompt event.
  if (promptEvent) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleInstall}
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Install app</span>
      </Button>
    );
  }

  // iOS Safari hint — small dismissible inline prompt that points at
  // the share sheet. iOS doesn't expose beforeinstallprompt at all
  // so this is the only way the user knows install is available.
  if (showIosHint) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
        <Share2 className="h-3.5 w-3.5" />
        <span>
          Install: tap Share → <strong>Add to Home Screen</strong>
        </span>
        <button
          type="button"
          onClick={dismissIosHint}
          aria-label="Dismiss install hint"
          className="ml-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return null;
}
