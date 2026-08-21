/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

import { fallbackNotification, isDuePayload, toNotification } from "./core/pushMessage";

/**
 * SB-051. The app's service worker.
 *
 * Until this file existed, `vite-plugin-pwa` ran in `generateSW` mode and
 * Workbox wrote the whole worker: correct for precaching, and with nowhere to
 * put a `push` handler. That is the switch this task pays for -- the caching
 * behaviour below is deliberately the same as what `generateSW` produced
 * (precache the shell, fall back to index.html for navigations), so the only
 * new behaviour is the two listeners at the bottom.
 *
 * The one thing a worker must not do is invent display text. It imports the
 * app's own catalogue through `toNotification`, so the Arabic wording still
 * lives in `web/src/i18n/ar.ts` and nowhere else -- which is possible only
 * because this file is bundled from source rather than emitted by Workbox.
 */

declare const self: ServiceWorkerGlobalScope;

// Injected at build time by `injectManifest`: the list of files to precache.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The app shell answers every navigation, so a cold launch works offline.
// API responses are deliberately not cached -- notes live in IndexedDB, which
// is queryable offline, and a stale HTTP cache would shadow it with older
// data than the device already has.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

// `registerType: "autoUpdate"` in the config takes effect through these two:
// a new worker activates immediately instead of waiting for every tab to
// close. Worth stating because it is the mechanism that lets a fix to THIS
// file reach an already-installed phone.
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * A push arrived. The app may be closed; this is the whole point of the task.
 *
 * `event.waitUntil` is not optional: the worker is killed as soon as the
 * handler returns, and a notification that has not been shown by then simply
 * never appears. Every browser also enforces `userVisibleOnly` -- failing to
 * show one costs the subscription itself.
 */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload: unknown;
    try {
      payload = event.data?.json();
    } catch {
      payload = null;
    }

    if (!isDuePayload(payload)) {
      // Not ours, or a shape this version does not know. Still show
      // something: a silent push is a subscription revoked.
      const fallback = fallbackNotification();
      await self.registration.showNotification(fallback.title, {
        tag: "wamda-due-tasks",
        data: { url: fallback.url },
      });
      return;
    }

    const notification = toNotification(payload);
    await self.registration.showNotification(notification.title, {
      body: notification.body,
      // One tag for the whole feature: a second morning's reminder REPLACES
      // the first rather than stacking. A tray with four identical reminders
      // is the failure mode this product exists to avoid.
      tag: "wamda-due-tasks",
      lang: notification.language,
      dir: notification.language === "ar" ? "rtl" : "ltr",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: notification.url },
    });
  })());
});

/**
 * Tapping the notification opens the task, and prefers a tab that is already
 * open -- opening a second copy of an installed PWA loses whatever the user
 * had on screen.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data?.url as string | undefined) ?? "/?tab=tasks";

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if ("focus" in client) {
        await client.focus();
        // Same window, new destination: `navigate` keeps the running app.
        if ("navigate" in client) await client.navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
