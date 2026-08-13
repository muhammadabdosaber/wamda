import { useEffect, useState } from "react";

import { categoryLabel, errorLabel, type Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import { ApiError, search } from "../data/api";
import { NoteDetail } from "./NoteDetail";

interface Hit {
  note_id: string;
  title: string | null;
  summary: string | null;
  category: string | null;
  language: string | null;
}

export function Search({ t, language }: { t: Translator; language: string }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Distinct from "zero hits": a request that never reached the server (or
  // failed there) must not read to the user as "you have no matching notes".
  const [error, setError] = useState<string | null>(null);
  // The hit whose detail sheet is open -- same pattern as Notes.tsx's `open`.
  const [open, setOpen] = useState<Hit | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits(null);
      setError(null);
      return;
    }

    // Debounced 350 ms. Every hybrid search costs an embedding call, so
    // firing per keystroke would bill an API request per character typed.
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      search(trimmed, language)
        .then((r) => setHits(r as unknown as Hit[]))
        .catch((err) => {
          console.error("search_failed", err instanceof Error ? err.message : err);
          setHits([]);
          setError(err instanceof ApiError ? err.code : "internal_error");
        })
        .finally(() => setBusy(false));
    }, 350);

    return () => clearTimeout(timer);
  }, [query, language]);

  return (
    <>
      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.t("searchHint")}
        aria-label={t.t("searchHint")}
      />

      {/* Not the full loading mark: this sits directly under the search box
          while results stream in, and a 64px pulsing disc between the query
          and its answers is more disruptive than the wait it describes. */}
      {busy && <p className="muted">{t.t("loading")}</p>}

      {error && !busy && <p className="center">{errorLabel(t, error)}</p>}
      {hits && hits.length > 0 && !busy && (
        <p className="muted search-count">{t.plural("searchResultCount", hits.length)}</p>
      )}
      {hits?.length === 0 && !busy && !error && <p className="center">{t.t("searchNoResults")}</p>}

      {hits?.map((hit) => (
        <div key={hit.note_id} className="card note-card" dir={directionOfContent(hit.language)}>
          <button className="note-open" onClick={() => setOpen(hit)}>
            {hit.title && <h3>{hit.title}</h3>}
            <p>{hit.summary ?? ""}</p>
            {hit.category && (
              <div className="chips">
                <span className="chip">{categoryLabel(t, hit.category)}</span>
              </div>
            )}
          </button>
        </div>
      ))}

      {open && (
        <NoteDetail
          t={t}
          noteId={open.note_id}
          enrichment={{
            title: open.title,
            summary: open.summary ?? "",
            category: open.category ?? "other",
          }}
          contentLanguage={open.language ?? language}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
