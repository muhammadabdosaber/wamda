import { useCallback, useEffect, useState } from "react";

import { actionLabel, categoryLabel, priorityLabel, type Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import {
  archiveNote,
  dismissNoteAction,
  isConfigured,
  restoreNoteAction,
  SYNCED_EVENT,
  timeline,
  type TimelineNote,
} from "../data/api";
import { pending as pendingNotes, type OutboxNote } from "../data/outbox";
import { Loading } from "../components/Loading";
import { NoteDetail } from "./NoteDetail";

/**
 * The timeline reads from TWO sources, and the local one is the one that must
 * never fail: notes still in the outbox are rendered alongside the server's.
 *
 * Without this the screen is a lie in two directions -- an offline user sees
 * an empty list even though their notes are safe on the device, and a note
 * captured one second ago is absent until the network agrees. It also removes
 * the only reason capture ever had to wait on `sync()` (see Capture.tsx).
 */
/**
 * Fixed order for the filter bar, so the chips do not reshuffle as notes
 * arrive. These are the seven identifiers the enrichment prompt can return --
 * stored values, never display text. The Arabic words live in the catalogue.
 */
const CATEGORY_ORDER = [
  "task",
  "event",
  "idea",
  "learning",
  "reference",
  "personal",
  "other",
] as const;

export function Notes({ t, language }: { t: Translator; language: string }) {
  const [notes, setNotes] = useState<TimelineNote[] | null>(null);
  // `null` is "all". A stored identifier, never a label -- the same rule the
  // chips themselves follow.
  const [category, setCategory] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState<OutboxNote[]>([]);
  // Not "error". The server being out of reach is an ordinary condition for
  // this app -- the notes below are still the right thing to be looking at.
  const [unreachable, setUnreachable] = useState(false);
  // The note whose full body is open in the detail sheet (SB-021/SB-037).
  const [open, setOpen] = useState<TimelineNote | null>(null);

  const load = useCallback(async () => {
    // Local first, and separately: IndexedDB does not depend on the network,
    // so a failing timeline request must not take the user's own notes down
    // with it.
    setUnsynced(await pendingNotes().catch(() => []));

    // With no Supabase URL there is no server to be unreachable -- the app
    // already says so in its own banner. Reporting it a second time as a
    // failed fetch would be noise about a build setting.
    if (!isConfigured) {
      setNotes([]);
      setUnreachable(false);
      return;
    }

    try {
      const page = await timeline(language);
      setNotes(page.notes);
      setUnreachable(false);
    } catch (err) {
      // Calm, generic copy for the user (see `unreachable` above) -- but the
      // real code (now that api.ts actually reads it off the response body)
      // is worth having in devtools when this needs debugging later.
      console.error("timeline_failed", err instanceof Error ? err.message : err);
      setNotes([]);
      setUnreachable(true);
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

  if (!notes) return <Loading label={t.t("loading")} skeleton="notes" />;

  // Server rows carry the client_id they were captured with, so a note is
  // never shown twice during the moment both sources still know about it.
  const onServer = new Set(notes.map((note) => note.client_id));
  // `pending()` is oldest-first for replay order; the timeline is newest-first.
  const local = unsynced.filter((note) => !onServer.has(note.clientId)).reverse();

  if (local.length === 0 && notes.length === 0) {
    // "No notes yet" would be a claim about the server, and the server did not
    // answer. Say which of the two it is.
    return (
      <p className="center">{unreachable ? t.t("notesOffline") : t.t("notesEmpty")}</p>
    );
  }

  // Only offer a chip for a category that is actually on screen. A filter that
  // is guaranteed to return nothing is worse than no filter -- and this keeps
  // the bar honest as the set grows past the seven above.
  const available = CATEGORY_ORDER.filter((id) =>
    notes.some((note) => note.note_enrichments[0]?.category === id),
  );

  const filtered = category
    ? notes.filter((note) => note.note_enrichments[0]?.category === category)
    : notes;

  // A note still in the outbox has not been enriched, so it has no category at
  // all. Any category filter necessarily excludes it -- shown under "all" only,
  // rather than silently reappearing under a filter it does not match.
  const localVisible = category ? [] : local;

  return (
    <>
      {/* Deliberately not an error. Nothing was lost, nothing needs retrying,
          and the notes below are exactly what the user should be reading --
          this line only explains why the list may be short.

          `navigator.onLine` used to gate this and was wrong: it reports the
          network adapter, not whether this app can reach its server, and it
          cheerfully says "online" while every request fails. */}
      {unreachable && <p className="muted center">{t.t("notesOffline")}</p>}

      {/* Shown whenever any note has been categorised at all, including when
          that is a single category. It was gated at two or more on the theory
          that one category offers no real choice -- but the owner opened the
          production app with two `مهمة` notes, saw no bar, and read the feature
          as missing rather than as deliberately quiet. A control that hides
          until your data happens to diversify is indistinguishable from a
          broken one.

          It scrolls horizontally rather than wrapping: a wrapping row changes
          height as chips come and go, which moves the whole list under the
          user's thumb. */}
      {available.length > 0 && (
        <div className="filter-bar" role="group" aria-label={t.t("filterLabel")}>
          <button
            className="filter-chip"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            {t.t("filterAll")}
          </button>
          {available.map((id) => (
            <button
              key={id}
              className="filter-chip"
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {categoryLabel(t, id)}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && localVisible.length === 0 && (
        <p className="center">{t.t("notesFilterEmpty")}</p>
      )}

      <div className="notes-grid">
      {localVisible.map((note) => (
        <PendingCard key={note.clientId} note={note} t={t} />
      ))}

      {filtered.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          t={t}
          onOpen={() => setOpen(note)}
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
          // Undo puts the suggestion back by clearing the timestamp, so the
          // chips return (SB-033).
          onRestored={() =>
            setNotes(
              (prev) =>
                prev?.map((n) =>
                  n.id === note.id ? { ...n, action_dismissed_at: null } : n,
                ) ?? prev,
            )
          }
        />
      ))}
      </div>

      {open && (
        <NoteDetail
          t={t}
          noteId={open.id}
          enrichment={open.note_enrichments[0]}
          contentLanguage={open.detected_language ?? open.input_language}
          onClose={() => setOpen(null)}
        />
      )}
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
  onOpen,
  onArchived,
  onDismissed,
  onRestored,
}: {
  note: TimelineNote;
  t: Translator;
  onOpen: () => void;
  onArchived: () => void;
  onDismissed: () => void;
  onRestored: () => void;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | "undo" | null>(null);
  const [failed, setFailed] = useState(false);
  // How the suggestion was just answered, so the resolved line can say which.
  // Local, because `action_dismissed_at` alone cannot tell "accepted" from
  // "ignored" (SB-027) -- and it is the immediate click that needs the feedback.
  const [resolution, setResolution] = useState<"accepted" | "dismissed" | null>(null);

  const enrichment = note.note_enrichments[0];

  if (!enrichment) {
    // Captured but not enriched yet -- or enrichment failed. Shown, not hidden:
    // the user must see their thought landed, even before (or without) the AI
    // saying anything about it. A failed note says so honestly rather than
    // claiming to still be "analysing" forever (SB-032).
    const failedEnrichment = note.status === "failed";
    return (
      <div className="card" dir={directionOfContent(note.detected_language ?? note.input_language)}>
        <p className="muted">
          {failedEnrichment ? t.t("statusFailed") : t.t("statusProcessing")}
        </p>
        <div className="chips">
          <span className="chip">{t.date(note.client_created_at)}</span>
        </div>
      </div>
    );
  }

  const answered = note.action_dismissed_at !== null;
  const action = answered ? null : actionLabel(t, enrichment.suggested_action);

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
        setResolution("accepted");
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
      setResolution("dismissed");
      onDismissed();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  // Reverses the dismiss/accept so the chips come back. The action was
  // otherwise irreversible from the UI (SB-033).
  async function handleUndo() {
    setFailed(false);
    setBusy("undo");
    try {
      await restoreNoteAction(note.id);
      setResolution(null);
      onRestored();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="card note-card"
      // The note body carries its OWN direction, derived from the language the
      // pipeline detected -- not from the UI locale. In phase 2 this is what
      // keeps an English note readable inside an Arabic UI.
      dir={directionOfContent(note.detected_language ?? note.input_language)}
    >
      {/* The title and summary open the source note -- the exact text captured,
          shown beside the AI's read of it (SB-021). A button so the keyboard
          and screen reader reach it; the actions below stay separate controls.

          The design puts the category and the time in a head row ABOVE the
          title, where the old layout had every chip in one row underneath. */}
      <button className="note-open" onClick={onOpen}>
        <div className="note-card-head">
          <span className="note-card-tags">
            {/* Chips render LOCALIZED labels from stored identifiers. The row
                holds 'task'; the word "مهمة" lives only in the catalogue. */}
            <span className="chip">{categoryLabel(t, enrichment.category)}</span>
            {enrichment.priority !== "normal" && (
              <span className={enrichment.priority === "urgent" ? "chip urgent" : "chip"}>
                {priorityLabel(t, enrichment.priority)}
              </span>
            )}
          </span>
          <span className="note-card-time">{t.date(note.client_created_at)}</span>
        </div>

        {enrichment.title && <h3>{enrichment.title}</h3>}
        {/* Clamped to three lines, per the design. The full text is one tap
            away in the detail sheet, so nothing is lost by truncating here. */}
        <p className="note-card-summary">{enrichment.summary}</p>
      </button>

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

      {answered && resolution && (
        // The resolved state. Without this, answering a suggestion just made
        // two links vanish and the owner reported "nothing happened" (SB-033).
        // A visible confirmation plus an undo, so the click is legible AND
        // reversible.
        <div className="resolved">
          <span className="resolved-label">
            <CheckIcon />
            {resolution === "accepted"
              ? t.t("notesActionAccepted")
              : t.t("notesActionDismissed")}
          </span>
          <button className="linkbtn" onClick={() => void handleUndo()} disabled={busy !== null}>
            {busy === "undo" ? "…" : t.t("notesActionUndo")}
          </button>
        </div>
      )}

      {failed && <p className="error-text">{t.t("errorGeneric")}</p>}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
