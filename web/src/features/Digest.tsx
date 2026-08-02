import { useEffect, useState } from "react";

import type { Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import { supabase } from "../data/api";

interface DigestContent {
  headline?: string;
  themes?: Array<{ title?: string; detail?: string }>;
  open_loops?: string[];
  wins?: string[];
  suggestion?: string;
}

/**
 * The weekly review.
 *
 * Framed as a re-orientation, not a backlog: what the week was about, what is
 * still open, what got done, and ONE suggested next step. Deliberately no
 * counts, no completion percentage, no streak -- those turn a review into a
 * scoreboard, and a scoreboard is the thing this user stops opening.
 */
export function Digest({ t, language }: { t: Translator; language: string }) {
  const [row, setRow] = useState<{ content: DigestContent; language: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Straight through PostgREST rather than an Edge Function: this is a
    // plain read with no vendor call, so RLS alone is the right gate.
    supabase
      .from("weekly_digests")
      .select("content, language")
      .eq("language", language)
      .order("period_start", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        setRow((data?.[0] as { content: DigestContent; language: string }) ?? null);
        setLoaded(true);
      });
  }, [language]);

  if (!loaded) return <p className="center">…</p>;
  if (!row) return <p className="center">{t.t("digestEmpty")}</p>;

  const c = row.content;

  return (
    <div dir={directionOfContent(row.language)}>
      {c.headline && <h2>{c.headline}</h2>}

      {c.themes?.map((theme, i) => (
        <div className="card" key={i}>
          {theme.title && <h3>{theme.title}</h3>}
          {theme.detail && <p>{theme.detail}</p>}
        </div>
      ))}

      {!!c.wins?.length && (
        <div className="card">
          {c.wins.map((w, i) => (
            <p key={i}>✓ {w}</p>
          ))}
        </div>
      )}

      {!!c.open_loops?.length && (
        <div className="card">
          {c.open_loops.map((o, i) => (
            <p key={i} className="muted">
              ○ {o}
            </p>
          ))}
        </div>
      )}

      {c.suggestion && (
        <div className="card">
          <p>{c.suggestion}</p>
        </div>
      )}
    </div>
  );
}
