// Web App Manifest — drives the "Add to Home Screen" / "Install app"
// experience. Next.js serves the JSON at /manifest.webmanifest from this
// file. iOS Safari + Android Chrome both read this; on iOS the install
// flow is Share → "Add to Home Screen", on Android the browser surfaces
// the install prompt once the page registers a service worker (see
// public/sw.js + components/pwa/PwaRegister.tsx).

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MK ADD VAULT",
    short_name: "MK ADD VAULT",
    description:
      "MK ADD VAULT — outdoor advertising business management platform.",
    // Launch the installed app straight to the dashboard, not the
    // marketing landing page. Locale prefix is optional; Next's
    // proxy.ts middleware handles the redirect to /en or /hi.
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#090C09",
    theme_color: "#090C09",
    orientation: "any",
    // The icon URLs map to app/icon.tsx + app/apple-icon.tsx (Next
    // generates the bytes via ImageResponse at request time). We
    // declare each PNG twice — once with purpose "any" (regular
    // home-screen icon) and once with "maskable" (Android adapts
    // the artwork to its current icon shape: squircle / circle /
    // squarish). Next's typings only accept a single purpose enum
    // value, hence the duplication.
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    // Hint to mobile browsers — "true" if the user has already
    // installed the PWA, the browser will route URLs into the
    // installed app rather than opening a new tab. (Standard PWA
    // option, not Next-specific.)
    prefer_related_applications: false,
  };
}
