import { useEffect, useMemo, useState, type ReactNode } from "react";

import { applyDirection, enabledTags, resolveLanguage, SUPPORTED } from "./core/language";
import { useSession } from "./core/session";
import { createTranslator } from "./i18n";
import { isConfigured, supabase, sync } from "./data/api";
import { AccountMenu } from "./components/AccountMenu";
import { Auth } from "./features/Auth";
import { Capture } from "./features/Capture";
import { Notes } from "./features/Notes";
import { Tasks } from "./features/Tasks";
import { Search } from "./features/Search";
import { Digest } from "./features/Digest";

const STORAGE_KEY = "ui_locale";
type Tab = "capture" | "notes" | "tasks" | "search" | "digest";

/**
 * Inline so no icon library is added just for five tab glyphs.
 *
 * The shapes follow Material Symbols Outlined -- `add_circle`, `description`,
 * `check_circle` -- because that is what the design export draws. They are
 * REDRAWN rather than loaded: the export pulls the icon font from the Google
 * Fonts CDN, and this app ships `font-src 'self'` (vite.config.ts). A CDN
 * glyph would be blocked outright in production, not merely off-convention.
 *
 * `search` and `digest` have no counterpart in the export -- it draws four
 * tabs, this app has five -- so they keep the house shapes they already had.
 */
const TAB_ICONS: Record<Tab, ReactNode> = {
  capture: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  notes: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13.4 3.75H7.5A1.75 1.75 0 0 0 5.75 5.5v13A1.75 1.75 0 0 0 7.5 20.25h9a1.75 1.75 0 0 0 1.75-1.75V8.6L13.4 3.75Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* The folded corner -- what separates Material's `description` from a
          plain rectangle with lines in it. */}
      <path d="M13.25 4.1v4.6h4.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 13h6M9 16.25h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  tasks: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8.4 12.2 2.6 2.6 4.6-5.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m19 19-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  digest: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 12a7.5 7.5 0 1 1 3 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M4.5 16v-4h4M11 8v4.5l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/**
 * Capture is deliberately absent from this set.
 *
 * Gating capture behind sign-in would break the one invariant the product
 * rests on: a thought must be capturable the instant the user has it. Notes
 * written while signed out sit in the local outbox and are pushed by `sync()`
 * as soon as a session exists — `capture_note` defaults `user_id` to
 * `auth.uid()`, so they attach to whoever signs in, with no reconciliation
 * step and nothing lost.
 */
const REQUIRES_AUTH: ReadonlySet<Tab> = new Set<Tab>(["notes", "tasks", "search", "digest"]);

export function App() {
  const [language, setLanguage] = useState(() =>
    resolveLanguage({
      explicit: localStorage.getItem(STORAGE_KEY),
      navigator: navigator.languages,
    }),
  );
  // Capture is the DEFAULT tab. The app opens ready to receive a thought;
  // anything between launch and capture is somewhere a thought is lost.
  const [tab, setTab] = useState<Tab>("capture");
  const [authOpen, setAuthOpen] = useState(false);

  const { session, loading } = useSession();
  const t = useMemo(() => createTranslator(language), [language]);

  // One effect owns document direction for the whole app. Every logical CSS
  // property resolves against it, so this single line is what mirrors the
  // entire UI -- there is no RTL stylesheet and no per-component work.
  useEffect(() => {
    applyDirection(language);
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  // Drain the outbox the moment a session appears. This is what turns
  // "capture before sign-in" from a compromise into the intended path.
  useEffect(() => {
    if (session) void sync();
  }, [session]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "capture", label: t.t("captureText") },
    { id: "notes", label: t.t("notesTitle") },
    { id: "tasks", label: t.t("tasksTitle") },
    { id: "search", label: t.t("searchTitle") },
    { id: "digest", label: t.t("digestTitle") },
  ];

  const available = enabledTags();
  const gated = !loading && !session && REQUIRES_AUTH.has(tab);
  const showAuth = authOpen || gated;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} className="brand-mark" />
          <h1>{t.t("appTitle")}</h1>
        </div>

        <div className="row-inline">
          {available.length > 1 && (
            <select
              className="select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label={t.t("settingsLanguage")}
            >
              {available.map((tag) => (
                // Each option is labelled in its OWN script -- someone who has
                // accidentally set the UI to a language they cannot read must
                // still be able to find their way back.
                <option key={tag} value={tag}>
                  {SUPPORTED[tag]?.label ?? tag}
                </option>
              ))}
            </select>
          )}

          {/* Hidden while the initial session lookup is in flight, so the
              control does not flip from "sign in" to the avatar on launch. */}
          {!loading &&
            (session ? (
              <AccountMenu
                t={t}
                onSignOut={() => {
                  void supabase.auth.signOut();
                  setAuthOpen(false);
                }}
              />
            ) : (
              <button className="linkbtn" onClick={() => setAuthOpen(true)}>
                {t.t("authTitle")}
              </button>
            ))}
        </div>
      </header>

      <main className="main">
        {/* Deliberately in English and not translated: this is a build
            misconfiguration aimed at whoever is running the app, not a
            user-facing state. */}
        {!isConfigured && (
          <div className="banner">
            Not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
            Capture still works offline; sync is disabled.
          </div>
        )}

        {showAuth ? (
          <Auth
            t={t}
            // Explains WHY the wall appeared when it was the tab that
            // triggered it, and stays silent when the user opened sign-in
            // themselves — where the reason would be stating the obvious.
            {...(gated ? { reason: t.t("authRequired") } : {})}
            onSignedIn={() => setAuthOpen(false)}
          />
        ) : (
          <>
            {/* After a save, hand off to the notes tab. The just-captured note
                appears there immediately -- rendered from the outbox while it
                syncs, then as its server row, and as a "processing" card if
                enrichment has not finished (SB-032). That the note shows up in
                the list is the strongest possible confirmation the save worked;
                the owner told us the in-place version read as failure. */}
            {tab === "capture" && (
              <Capture t={t} language={language} onSaved={() => setTab("notes")} />
            )}
            {tab === "notes" && <Notes t={t} language={language} />}
            {tab === "tasks" && <Tasks t={t} language={language} />}
            {tab === "search" && <Search t={t} language={language} />}
            {tab === "digest" && <Digest t={t} language={language} />}
          </>
        )}
      </main>

      <nav className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            className="tab"
            aria-selected={tab === item.id}
            onClick={() => {
              setTab(item.id);
              // Leaving the sign-in screen by picking a tab should dismiss it;
              // the gate re-applies on its own if that tab needs auth.
              setAuthOpen(false);
            }}
          >
            {TAB_ICONS[item.id]}
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
