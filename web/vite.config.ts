// defineConfig from vitest/config, not vite: vite's own defineConfig has no
// `test` key and rejects the block below.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "الدماغ الثاني",
        short_name: "الدماغ الثاني",
        description: "التقط أفكارك بسرعة، ودع الذكاء الاصطناعي ينظّمها.",
        // The manifest is what makes the installed app open in Arabic RTL
        // from the launcher. Omit these two and the OS renders the app name
        // and splash screen left-to-right regardless of the page's own dir.
        lang: "ar",
        dir: "rtl",
        theme_color: "#3e6b5c",
        background_color: "#faf8f5",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // The app shell is precached so a cold launch works offline. API
        // responses are deliberately NOT cached here -- notes live in
        // IndexedDB, which is queryable and writable offline. A stale HTTP
        // cache would shadow the local store and show the user older data
        // than they have on device.
        navigateFallback: "index.html",
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
