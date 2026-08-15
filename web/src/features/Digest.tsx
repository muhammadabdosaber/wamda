import { useEffect, useState } from "react";

import type { Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import { supabase } from "../data/api";
import { Loading } from "../components/Loading";

interface DigestContent {
  headline?: string;
  themes?: Array<{ title?: string; detail?: string }>;
  open_loops?: string[];
  wins?: string[];
  suggestion?: string;
}

interface DigestRow {
  id: string;
  content: DigestContent;
  language: string;
  period_start: string;
  period_end: string;
}

// Half a year of weekly rows. Bounded, not unbounded: this table gains one
// row a week forever (SB-049), and nothing else caps how far the picker reaches.
const HISTORY_LIMIT = 26;

/**
 * The weekly review.
 *
 * Framed as a re-orientation, not a backlog: what the week was about, what is
 * still open, what got done, and ONE suggested next step. Deliberately no
 * counts, no completion percentage, no streak -- those turn a review into a
 * scoreboard, and a scoreboard is the thing this user stops opening.
 */
export function Digest({ t, language }: { t: Translator; language: string }) {
  const [rows, setRows] = useState<DigestRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    // Straight through PostgREST rather than an Edge Function: this is a
    // plain read with no vendor call, so RLS alone is the right gate.
    //
    // Not filtered by UI language: a digest is written in whatever language
    // that week's notes were in (see supabase/functions/digest), which need
    // not match the reader's current UI language. Filtering here would make
    // real past weeks disappear instead of rendering under their own
    // direction, which this component already does per row below.
    supabase
      .from("weekly_digests")
      .select("id, content, language, period_start, period_end")
      .order("period_start", { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data }) => {
        const list = (data as DigestRow[] | null) ?? [];
        setRows(list);
        setSelectedId(list[0]?.id ?? null);
      });
  }, []);

  if (!rows) return <Loading label={t.t("loading")} />;
  if (rows.length === 0) return <p className="center">{t.t("digestEmpty")}</p>;

  const selected = rows.find((r) => r.id === selectedId) ?? rows[0]!;
  const c = selected.content;

  return (
    <>
      {/* Only worth a picker once there is a second week to pick. Newest is
          selected on load, so a reader who never touches this sees exactly
          what they saw before this existed. */}
      {rows.length > 1 && (
        <div className="filter-bar" role="group" aria-label={t.t("digestHistoryLabel")}>
          {rows.map((digestRow, i) => (
            <button
              key={digestRow.id}
              className="filter-chip"
              aria-pressed={digestRow.id === selected.id}
              onClick={() => setSelectedId(digestRow.id)}
            >
              {i === 0 ? t.t("digestThisWeek") : weekRangeLabel(digestRow, language)}
            </button>
          ))}
        </div>
      )}

      <div dir={directionOfContent(selected.language)}>
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
    </>
  );
}

/**
 * `period_end` is exclusive (`weekWindow` in `supabase/functions/digest`), so
 * the last day the reader actually experienced is one day before it.
 */
function weekRangeLabel(row: DigestRow, language: string): string {
  const fmt = new Intl.DateTimeFormat(language, { day: "numeric", month: "short" });
  const start = new Date(`${row.period_start}T00:00:00Z`);
  const end = new Date(`${row.period_end}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}
