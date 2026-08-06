import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { sync } from "./data/api";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// SB-003: make CSP violations visible instead of silently-blocked network
// calls or dead buttons. A `<meta>` CSP cannot carry `report-to` (the spec
// has browsers ignore that directive there), so this is the reporting
// mechanism until a real host header can carry one -- console-visible today,
// and a straightforward place to add a POST once SB-019 gives it somewhere
// to land.
window.addEventListener("securitypolicyviolation", (e) => {
  console.error("csp_violation", {
    directive: e.violatedDirective,
    blocked: e.blockedURI,
    source: e.sourceFile ? `${e.sourceFile}:${e.lineNumber}` : undefined,
  });
});

// Drain the outbox whenever connectivity returns.
//
// This is the browser's substitute for a native background sync worker. It
// only runs while a tab is open, which is the honest limitation of a PWA
// here: a note captured offline syncs the next time the user opens the app,
// not while it is closed. Background Sync API would close the gap on Chromium
// but is unavailable on Safari, so the app must be correct without it.
window.addEventListener("online", () => {
  void sync();
});

if (navigator.onLine) void sync();
