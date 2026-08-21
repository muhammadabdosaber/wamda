// defineConfig from vitest/config, not vite: vite's own defineConfig has no
// `test` key and rejects the block below.
import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * SB-003: strict CSP. `connect-src` must name the Supabase origin explicitly
 * -- in every real setup (local dev included: app on :5174, API on :54421)
 * it is a DIFFERENT origin than the page, so `'self'` alone would block every
 * API call. Built once here so the dev/preview header and the meta tag baked
 * into the shipped HTML can never drift apart.
 *
 * `frame-ancestors` is a real HTTP-header-only directive -- the spec has
 * browsers silently ignore it inside a `<meta>` CSP, so it is omitted there
 * rather than shipped as dead weight. Whatever host SB-016 deploys to needs
 * to set it (and ideally `report-to`, which has the same meta-tag limit) at
 * the server layer; that is a real gap, recorded in docs/08-security.md, not
 * silently worked around.
 */
function buildCsp(supabaseUrl: string, { includeFrameAncestors }: { includeFrameAncestors: boolean }) {
  const connectSrc = ["'self'"];
  try {
    connectSrc.push(new URL(supabaseUrl).origin);
  } catch {
    // No configured Supabase URL (e.g. a fresh checkout before .env.local
    // exists) -- 'self' still lets the app boot into its "not configured"
    // state, which is all it can do anyway without a URL.
  }

  const directives = [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self'`,
    `img-src 'self'`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(" ")}`,
    `worker-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  if (includeFrameAncestors) directives.push(`frame-ancestors 'self'`);
  return directives.join("; ");
}

/**
 * Injects the meta-tag CSP into the built HTML so it ships with the bundle
 * regardless of which static host eventually serves it (SB-016 undecided).
 *
 * `apply: "build"` -- a Vite plugin hook with no `apply` filter runs in BOTH
 * `vite build` and `vite dev`, since both call `transformIndexHtml`. Without
 * this, the meta tag lands in the dev-served HTML too and blocks the exact
 * same inline Fast Refresh preamble the header already had to be kept off
 * of, for the exact same reason -- found live, alongside that bug, not two
 * separate incidents.
 */
function cspMetaPlugin(csp: string): Plugin {
  return {
    name: "second-brain-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: csp },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const cspHeader = buildCsp(env.VITE_SUPABASE_URL ?? "", { includeFrameAncestors: true });
  const cspMeta = buildCsp(env.VITE_SUPABASE_URL ?? "", { includeFrameAncestors: false });

  return {
  plugins: [
    react(),
    cspMetaPlugin(cspMeta),
    VitePWA({
      registerType: "autoUpdate",
      // SB-051: `injectManifest`, not the default `generateSW`. Web push
      // needs a `push` listener, and a worker Workbox writes for you has
      // nowhere to put one. The cost is that `web/src/sw.ts` now owns the
      // precaching too -- it does the same two things generateSW did, and
      // `workbox.globPatterns` below still supplies the file list.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "ومضة",
        short_name: "ومضة",
        description: "التقط أفكارك بسرعة، ودع الذكاء الاصطناعي ينظّمها.",
        // The manifest is what makes the installed app open in Arabic RTL
        // from the launcher. Omit these two and the OS renders the app name
        // and splash screen left-to-right regardless of the page's own dir.
        lang: "ar",
        dir: "rtl",
        theme_color: "#334155",
        background_color: "#f8fafc",
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
      // Under `injectManifest` this is `injectManifest`, not `workbox`: the
      // plugin only uses it to build the file list it substitutes for
      // `self.__WB_MANIFEST`. Runtime caching behaviour moved into
      // `src/sw.ts` (the navigation fallback is registered there).
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
      devOptions: { enabled: false },
    }),
  ],
  // `vite preview` (the built app) and the shipped meta tag both carry the
  // real header -- `vite dev` deliberately does NOT. `@vitejs/plugin-react`
  // injects an INLINE `<script>` preamble into the dev HTML for Fast Refresh,
  // which `script-src 'self'` (no `unsafe-inline`) blocks outright: React
  // never mounts, the app renders nothing, and no console error explains why
  // -- found live, the hard way, not reasoned about in advance. CSP protects
  // the shipped app; Vite's own dev-time tooling is not part of it.
  preview: { headers: { "Content-Security-Policy": cspHeader } },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  };
});
