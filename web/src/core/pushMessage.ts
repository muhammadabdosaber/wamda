import { createTranslator } from "../i18n";

/**
 * SB-051. What a push payload turns into on screen.
 *
 * The server sends counts, ids and the task's own title -- never a label.
 * Every word the APP says ("مهام مستحقة", the plurals) is built here, from
 * the same catalogue the Tasks tab uses for its badge. That is rule 2 applied
 * to the wire: a transmitted display label cannot be reworded without
 * redeploying the sender, and a notification queued on a push service for
 * hours would arrive with wording the app no longer uses. The task title is
 * different in kind: it is the user's content (the note's own title), not a
 * label, and it travels end-to-end encrypted (RFC 8291) -- the push service
 * never reads it.
 *
 * Pure, and separate from `sw.ts`, because a service worker cannot be
 * unit-tested: it has no DOM, no module graph a test runner will load, and
 * the only way to exercise it is to install it in a browser. Everything
 * decidable without a browser lives here instead.
 */

/** The morning summary: all open tasks overdue or due today. */
export interface DuePayload {
  kind: "due-tasks";
  overdue: number;
  dueToday: number;
  noteId: string | null;
  /** Title of the most urgent task. Absent from senders before 2026-10-21. */
  title?: string | null;
  language: string;
}

/** One task whose own due time has just arrived. */
export interface TaskDuePayload {
  kind: "task-due";
  noteId: string;
  title: string | null;
  language: string;
}

export type PushPayload = DuePayload | TaskDuePayload;

export interface Notification {
  title: string;
  body: string;
  /** Where a tap lands. The note id is carried so the app can open that task. */
  url: string;
  language: string;
  /**
   * Notifications with the same tag replace each other. The summary keeps one
   * tag (tomorrow's replaces today's); each task reminder gets its own, so two
   * tasks due at 10:00 are two notifications, not one overwriting the other.
   */
  tag: string;
}

/**
 * Shown when a push arrives that this version cannot read. Every browser
 * revokes a subscription that receives a push and shows nothing, so the
 * choice is between a vague notification and losing notifications entirely.
 *
 * The title still comes from the catalogue: `sw.ts` must contain no display
 * text of its own (rule 2), fallback path included.
 */
export function fallbackNotification(language = "ar"): Notification {
  const t = createTranslator(language);
  return { title: t.t("appTitle"), body: "", url: "/?tab=tasks", language, tag: "wamda-due-tasks" };
}

/** A payload that did not come from this project's own sender is not rendered. */
export function isDuePayload(value: unknown): value is DuePayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<DuePayload>;
  return (
    p.kind === "due-tasks" &&
    typeof p.overdue === "number" &&
    typeof p.dueToday === "number" &&
    typeof p.language === "string" &&
    (p.title === undefined || p.title === null || typeof p.title === "string")
  );
}

export function isTaskDuePayload(value: unknown): value is TaskDuePayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<TaskDuePayload>;
  return (
    p.kind === "task-due" &&
    typeof p.noteId === "string" &&
    (p.title === null || typeof p.title === "string") &&
    typeof p.language === "string"
  );
}

export function isPushPayload(value: unknown): value is PushPayload {
  return isDuePayload(value) || isTaskDuePayload(value);
}

const taskUrl = (noteId: string | null) => (noteId ? `/?tab=tasks&note=${noteId}` : "/?tab=tasks");

/**
 * Build the notification from a payload.
 *
 * Summary: the body names the most urgent task, because a title is what
 * makes a reminder actionable from the lock screen -- "one task is overdue"
 * still has to be opened to mean anything. When there are more, one line
 * says how many, from a plural that is correct across all six Arabic
 * categories. With no title (an old sender, or an untitled note) it falls
 * back to the count sentence it always showed.
 */
export function toNotification(payload: PushPayload): Notification {
  const t = createTranslator(payload.language);

  if (payload.kind === "task-due") {
    return {
      title: t.t("pushTaskDueTitle"),
      body: payload.title ?? "",
      url: taskUrl(payload.noteId),
      language: payload.language,
      tag: `wamda-task-${payload.noteId}`,
    };
  }

  const total = payload.overdue + payload.dueToday;
  const title = payload.title?.trim();
  const body = title
    ? total > 1
      ? `${title}\n${t.plural("pushMoreTasks", total - 1)}`
      : title
    : t.plural("tasksDueSoonCount", total);

  return {
    title: t.t("pushDueTitle"),
    body,
    url: taskUrl(payload.noteId),
    language: payload.language,
    tag: "wamda-due-tasks",
  };
}
