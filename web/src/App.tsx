import { useEffect, useMemo, useState } from "react";

import { applyDirection, enabledTags, resolveLanguage, SUPPORTED } from "./core/language";
import { useSession } from "./core/session";
import { createTranslator } from "./i18n";
import { isConfigured, supabase, sync } from "./data/api";
import { Auth } from "./features/Auth";
import { Capture } from "./features/Capture";
import { Notes } from "./features/Notes";
import { Search } from "./features/Search";
import { Digest } from "./features/Digest";

const STORAGE_KEY = "ui_locale";
type Tab = "capture" | "notes" | "search" | "digest";

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
const REQUIRES_AUTH: ReadonlySet<Tab> = new Set<Tab>(["notes", "search", "digest"]);

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
    { id: "search", label: t.t("searchTitle") },
    { id: "digest", label: t.t("digestTitle") },
  ];

  const available = enabledTags();
  const gated = !loading && !session && REQUIRES_AUTH.has(tab);
  const showAuth = authOpen || gated;

  return (
    <div className="app">
      <header className="header">
        <h1>{t.t("appTitle")}</h1>

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
              button does not flip from "sign in" to "sign out" on launch. */}
          {!loading &&
            (session ? (
              <button
                className="linkbtn"
                onClick={() => {
                  void supabase.auth.signOut();
                  setAuthOpen(false);
                }}
              >
                {t.t("authSignOut")}
              </button>
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
            {tab === "capture" && <Capture t={t} language={language} />}
            {tab === "notes" && <Notes t={t} language={language} />}
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
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
