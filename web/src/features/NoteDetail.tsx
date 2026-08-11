import { useEffect, useState } from "react";

import type { Translator } from "../i18n";
import { categoryLabel } from "../i18n";
import { directionOfContent } from "../core/language";
import { noteDetail, type Enrichment, type NoteDetail as NoteBody } from "../data/api";
import { Loading } from "../components/Loading";

/**
 * The single-note detail view, opened from a note card or a task row.
 *
 * This is what keeps a task a VIEW over its note rather than a separate object
 * (SB-037): tapping a task shows the exact text captured, its date, and the
 * AI's read of it, side by side. The summary and category already travelled
 * with the timeline; only `raw_text` is fetched here, because the timeline
 * omits it on purpose (a full body per row is a 30x heavier response).
 */
export function NoteDetail({
  t,
  noteId,
  enrichment,
  contentLanguage,
  onClose,
}: {
  t: Translator;
  noteId: string;
  enrichment: Enrichment | undefined;
  contentLanguage: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState<NoteBody | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    noteDetail(noteId)
      .then((b) => live && setBody(b))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [noteId]);

  // Esc closes, matching the backdrop click. A detail view the user cannot
  // dismiss with the keyboard is a trap on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dir = directionOfContent(contentLanguage);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.t("detailTitle")}
        // Clicks inside the sheet must not fall through to the backdrop and
        // close it.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>{t.t("detailTitle")}</h2>
          <button className="linkbtn" onClick={onClose}>
            {t.t("detailClose")}
          </button>
        </div>

        {failed ? (
          <p className="error-text">{t.t("detailLoadFailed")}</p>
        ) : !body ? (
          <Loading label={t.t("loading")} />
        ) : (
          <div dir={dir}>
            {enrichment?.title && <h3>{enrichment.title}</h3>}
            {enrichment && (
              <p className="detail-summary">{enrichment.summary}</p>
            )}

            <div className="chips">
              {enrichment && (
                <span className="chip">{categoryLabel(t, enrichment.category)}</span>
              )}
              <span className="chip">{t.date(body.client_created_at)}</span>
            </div>

            {/* The reason the view exists: the words the user actually typed,
                not the AI's paraphrase. */}
            <p className="detail-raw-label">{t.t("detailRawLabel")}</p>
            <p className="detail-raw">{body.raw_text || t.t("notesVoiceNote")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
