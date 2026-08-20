import { useCallback, useEffect, useMemo, useState } from "react";

import { priorityLabel, type Translator } from "../i18n";
import { directionOfContent } from "../core/language";
import { bucketOf, isOverdue, type Bucket } from "../core/due";
import { useNow } from "../core/clock";
import {
  isConfigured,
  setNoteCompleted,
  SYNCED_EVENT,
  timeline,
  type TimelineNote,
} from "../data/api";
import { Loading } from "../components/Loading";
import { NoteDetail } from "./NoteDetail";

/**
 * The Tasks screen is a FILTER OVER NOTES, not a container -- ADR-0004. A note
 * whose enrichment reads `category = 'task'` shows here; it is the same note
 * that lives in the timeline, never a separate object it was moved into.
 * Tapping one opens the source note (SB-037), which is what keeps it a view.
 *
 * Grouping is by `note_enrichments.action_due_at`, which the model already
 * resolves ("الخميس" -> the right Thursday) and the timeline already returns --
 * so this screen needs no new column and no new endpoint (SB-036).
 */
const BUCKET_HEADING: Record<Bucket, "tasksToday" | "tasksThisWeek" | "tasksLater"> = {
  today: "tasksToday",
  week: "tasksThisWeek",
  later: "tasksLater",
};

export function Tasks({ t, language }: { t: Translator; language: string }) {
  const [notes, setNotes] = useState<TimelineNote[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [open, setOpen] = useState<TimelineNote | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    if (!isConfigured) {
      setNotes([]);
      setUnreachable(false);
      return;
    }
    try {
      // One page is enough for a task list: the model marks few notes as tasks,
      // and the timeline is newest-first, so the actionable ones are near the
      // top. Pagination is the notes timeline's concern, not this filter's.
      const page = await timeline(language);
      setNotes(page.notes);
      setUnreachable(false);
    } catch {
      setNotes([]);
      setUnreachable(true);
    }
  }, [language]);

  useEffect(() => {
    void load();
    const onSynced = () => void load();
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, [load]);

  // Toggle completion optimistically: the tick must feel instant, and the
  // write is a single owned column. On failure, put the state back.
  const toggle = useCallback(async (note: TimelineNote) => {
    const done = !note.completed_at;
    setNotes((prev) =>
      prev?.map((n) =>
        n.id === note.id ? { ...n, completed_at: done ? new Date().toISOString() : null } : n,
      ) ?? prev,
    );
    try {
      await setNoteCompleted(note.id, done);
    } catch {
      setNotes((prev) =>
        prev?.map((n) => (n.id === note.id ? { ...n, completed_at: note.completed_at } : n)) ?? prev,
      );
    }
  }, []);

  const groups = useMemo(() => {
    const tasks = (notes ?? []).filter((n) => n.note_enrichments[0]?.category === "task");
    const by: Record<Bucket, TimelineNote[]> = { today: [], week: [], later: [] };
    for (const note of tasks) {
      by[bucketOf(note.note_enrichments[0]!.action_due_at, now)].push(note);
    }
    // Within a group: open tasks first, then completed; each by due date, with
    // no-date tasks last.
    const rank = (n: TimelineNote) =>
      (n.completed_at ? 1e15 : 0) +
      (n.note_enrichments[0]!.action_due_at ? new Date(n.note_enrichments[0]!.action_due_at!).getTime() : 8.64e15);
    for (const b of Object.keys(by) as Bucket[]) by[b].sort((a, c) => rank(a) - rank(c));
    return by;
  }, [notes, now]);

  if (!notes) return <Loading label={t.t("loading")} skeleton="tasks" />;

  const order: Bucket[] = ["today", "week", "later"];
  const total = order.reduce((sum, b) => sum + groups[b].length, 0);

  if (total === 0) {
    return <p className="center">{unreachable ? t.t("notesOffline") : t.t("tasksEmpty")}</p>;
  }

  return (
    <>
      {unreachable && <p className="muted center">{t.t("notesOffline")}</p>}

      {order.map((bucket) => {
        const items = groups[bucket];
        if (items.length === 0) return null;
        const openCount = items.filter((n) => !n.completed_at).length;
        return (
          <section key={bucket} className="task-group">
            <div className="task-group-head">
              <h2>{t.t(BUCKET_HEADING[bucket])}</h2>
              <span className="task-count">{t.plural("taskCount", openCount)}</span>
            </div>
            {items.map((note) => (
              <TaskRow
                key={note.id}
                note={note}
                t={t}
                now={now}
                onToggle={() => void toggle(note)}
                onOpen={() => setOpen(note)}
              />
            ))}
          </section>
        );
      })}

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

/** `normal` gets no rail at all -- most tasks are normal, and a rail on every
 *  row is noise, which is the one thing this product exists to remove. */
const RAIL: Record<string, string> = {
  urgent: "rail rail-urgent",
  high: "rail rail-high",
  low: "rail rail-low",
};

function TaskRow({
  note,
  t,
  now,
  onToggle,
  onOpen,
}: {
  note: TimelineNote;
  t: Translator;
  now: Date;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const e = note.note_enrichments[0]!;
  const done = Boolean(note.completed_at);
  // A completed task is never "late" -- it is finished. Marking one overdue
  // would nag about work already done, which is the opposite of the point.
  const late = !done && isOverdue(e.action_due_at, now);
  const railClass = (e.priority ? RAIL[e.priority] : null) ?? "rail";
  const priority = priorityLabel(t, e.priority);

  return (
    <div className={`task-row${done ? " done" : ""}`}>
      <span className={railClass} aria-hidden="true" />

      <input
        type="checkbox"
        className="task-check"
        checked={done}
        onChange={onToggle}
        // The priority is on the rail visually; the checkbox still needs a name
        // for a screen reader, so it reads the task rather than "checkbox".
        aria-label={e.title ?? e.summary}
      />

      {/* The body opens the source note. A button, not the whole row, so the
          checkbox keeps its own hit target. */}
      <button className="task-body" onClick={onOpen} dir={directionOfContent(note.detected_language ?? note.input_language)}>
        <span className="task-title">{e.title ?? e.summary}</span>
        <span className="chips">
          {priority && (
            <span className={e.priority === "urgent" ? "chip urgent" : "chip"}>
              {priority}
            </span>
          )}
          {/* Overdue and due-today sit in the SAME group by design, so this
              chip is the only thing separating a task three days late from
              one due tonight. The word is carried alongside the date, not
              instead of it -- colour alone would not survive a screen reader
              or a red-green deficiency. */}
          <span className={late ? "chip overdue" : "chip"}>
            {late && <span className="chip-flag">{t.t("tasksOverdue")}</span>}
            {e.action_due_at ? t.date(e.action_due_at) : t.t("tasksNoDate")}
          </span>
        </span>
      </button>
    </div>
  );
}
