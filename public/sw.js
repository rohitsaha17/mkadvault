/* Minimal service worker — exists so Chrome's PWA "Install" install
 * banner appears. The criteria require the page to register a worker
 * that handles `fetch` events; the worker doesn't need to actually
 * cache or transform anything. We pass every request straight through
 * to the network so behaviour is identical to having no SW at all,
 * but the browser sees a fetch handler and unlocks Install.
 *
 * Why a static file, not next-pwa: a thin pass-through is ~20 lines.
 * next-pwa would pull in workbox + a build step for the sake of one
 * checkbox in Chrome's install criteria. Easier to maintain this by
 * hand and skip the dependency.
 *
 * Keep this file plain JS (no module syntax) so the browser can load
 * it directly without bundling.
 */

self.addEventListener("install", (event) => {
  // Become the active worker immediately on first install — without
  // this the user has to fully close every tab before the new SW
  // takes over. Acceptable here because we don't cache anything.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Take control of pages that loaded before the SW registered (e.g.
  // the very first visit after a redeploy bumps the SW URL).
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pure pass-through — no caching, no rewriting. The handler
  // existing is what matters for Install eligibility.
  event.respondWith(fetch(event.request));
});
