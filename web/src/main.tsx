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
