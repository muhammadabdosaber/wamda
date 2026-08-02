import { useEffect, useState } from "react";

import { actionLabel, categoryLabel, priorityLabel, type Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import { timeline, type TimelineNote } from "../data/api";

export function Notes({ t, language }: { t: Translator; language: string }) {
  const [notes, setNotes] = useState<TimelineNote[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    timeline(language)
      .then((page) => !cancelled && setNotes(page.notes))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [language]);

  if (error) return <p className="center">{t.t("errorGeneric")}</p>;
  if (!notes) return <p className="center">…</p>;
  if (notes.length === 0) return <p className="center">{t.t("notesEmpty")}</p>;

  return (
    <>
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} t={t} />
      ))}
    </>
  );
}

function NoteCard({ note, t }: { note: TimelineNote; t: Translator }) {
  const enrichment = note.note_enrichments[0];

  if (!enrichment) {
    // Captured but not yet enriched. Shown, not hidden: the user must be able
    // to see that their thought landed, even before the AI has said anything
    // about it.
    return (
      <div className="card">
        <p className="muted">{t.t("statusProcessing")}</p>
      </div>
    );
  }

  const action = actionLabel(t, enrichment.suggested_action);

  return (
    <div
      className="card"
      // The note body carries its OWN direction, derived from the language the
      // pipeline detected -- not from the UI locale. In phase 2 this is what
      // keeps an English note readable inside an Arabic UI.
      dir={directionOfContent(note.detected_language ?? note.input_language)}
    >
      {enrichment.title && <h3>{enrichment.title}</h3>}
      <p>{enrichment.summary}</p>

      <div className="chips">
        {/* Chips render LOCALIZED labels from stored identifiers. The row
            holds 'task'; the word "مهمة" lives only in the catalogue. */}
        <span className="chip">{categoryLabel(t, enrichment.category)}</span>
        {enrichment.priority !== "normal" && (
          <span className={enrichment.priority === "urgent" ? "chip urgent" : "chip"}>
            {priorityLabel(t, enrichment.priority)}
          </span>
        )}
        <span className="chip">{t.date(note.client_created_at)}</span>
      </div>

      {action && (
        // A suggestion the user accepts or ignores -- never applied silently.
        // Auto-filing that guesses wrong destroys trust in everything else the
        // AI produced.
        <div className="chips">
          <button className="linkbtn">{action}</button>
          <button className="linkbtn muted">{t.t("actionDismiss")}</button>
        </div>
      )}
    </div>
  );
}
