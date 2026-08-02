import { useCallback, useEffect, useState } from "react";

import { actionLabel, categoryLabel, priorityLabel, type Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import {
  archiveNote,
  dismissNoteAction,
  SYNCED_EVENT,
  timeline,
  type TimelineNote,
} from "../data/api";
import { pending as pendingNotes, type OutboxNote } from "../data/outbox";

/**
 * The timeline reads from TWO sources, and the local one is the one that must
 * never fail: notes still in the outbox are rendered alongside the server's.
 *
 * Without this the screen is a lie in two directions -- an offline user sees
 * an empty list even though their notes are safe on the device, and a note
 * captured one second ago is absent until the network agrees. It also removes
 * the only reason capture ever had to wait on `sync()` (see Capture.tsx).
 */
export function Notes({ t, language }: { t: Translator; language: string }) {
  const [notes, setNotes] = useState<TimelineNote[] | null>(null);
  const [unsynced, setUnsynced] = useState<OutboxNote[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    // Local first, and separately: IndexedDB does not depend on the network,
    // so a failing timeline request must not take the user's own notes down
    // with it.
    setUnsynced(await pendingNotes().catch(() => []));
    try {
      const page = await timeline(language);
      setNotes(page.notes);
      setError(false);
    } catch {
      setNotes([]);
      setError(true);
    }
  }, [language]);

  useEffect(() => {
    void load();
    // A note captured seconds ago stops being a local placeholder and becomes
    // its enriched card on its own, without the user reloading anything.
    const onSynced = () => void load();
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, [load]);

  if (!notes) return <p className="center">…</p>;

  // Server rows carry the client_id they were captured with, so a note is
  // never shown twice during the moment both sources still know about it.
  const onServer = new Set(notes.map((note) => note.client_id));
  // `pending()` is oldest-first for replay order; the timeline is newest-first.
  const local = unsynced.filter((note) => !onServer.has(note.clientId)).reverse();

  if (local.length === 0 && notes.length === 0) {
    return <p className="center">{error ? t.t("errorGeneric") : t.t("notesEmpty")}</p>;
  }

  return (
    <>
      {/* Only when the request could plausibly have succeeded. Offline is a
          normal state here, not an error to report -- the notes below are
          exactly what the user should be looking at. */}
      {error && navigator.onLine && (
        <p className="muted center">{t.t("errorGeneric")}</p>
      )}

      {local.map((note) => (
        <PendingCard key={note.clientId} note={note} t={t} />
      ))}

      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          t={t}
          // Archiving removes the row outright; dismissing just marks this
          // note's card so the suggestion stops being offered.
          onArchived={() => setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? prev)}
          onDismissed={() =>
            setNotes(
              (prev) =>
                prev?.map((n) =>
                  n.id === note.id ? { ...n, action_dismissed_at: new Date().toISOString() } : n,
                ) ?? prev,
            )
          }
        />
      ))}
    </>
  );
}

/**
 * A note that exists on this device and nowhere else yet. No enrichment, no
 * actions -- the AI has not seen it. The wording is deliberately reassuring
 * rather than a warning: nothing is wrong, and nothing is at risk.
 */
function PendingCard({ note, t }: { note: OutboxNote; t: Translator }) {
  return (
    <div className="card pending" dir={directionOfContent(note.language)}>
      <p>{note.text || t.t("notesVoiceNote")}</p>
      <div className="chips">
        <span className="chip">{t.t("notesPendingSync")}</span>
        <span className="chip">{t.date(note.capturedAt)}</span>
      </div>
    </div>
  );
}

function NoteCard({
  note,
  t,
  onArchived,
  onDismissed,
}: {
  note: TimelineNote;
  t: Translator;
  onArchived: () => void;
  onDismissed: () => void;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [failed, setFailed] = useState(false);

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

  const action = note.action_dismissed_at ? null : actionLabel(t, enrichment.suggested_action);

  // The action button's own effect depends on what it is suggesting: for
  // "archive" it performs the real archive; every other suggestion (create a
  // task, create an event, review later) has no destination system yet, so
  // accepting it just records that the user responded, same as dismissing.
  async function handleAccept() {
    setFailed(false);
    setBusy("accept");
    try {
      if (enrichment!.suggested_action === "archive") {
        await archiveNote(note.id);
        onArchived();
      } else {
        await dismissNoteAction(note.id);
        onDismissed();
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss() {
    setFailed(false);
    setBusy("dismiss");
    try {
      await dismissNoteAction(note.id);
      onDismissed();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

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
          <button className="linkbtn" onClick={() => void handleAccept()} disabled={busy !== null}>
            {busy === "accept" ? "…" : action}
          </button>
          <button
            className="linkbtn muted"
            onClick={() => void handleDismiss()}
            disabled={busy !== null}
          >
            {busy === "dismiss" ? "…" : t.t("actionDismiss")}
          </button>
        </div>
      )}

      {failed && <p className="error-text">{t.t("errorGeneric")}</p>}
    </div>
  );
}
