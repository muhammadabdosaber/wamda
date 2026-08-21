import { createTranslator } from "../i18n";

/**
 * SB-051. What a push payload turns into on screen.
 *
 * The server sends counts and an id, never text (see `functions/push`): the
 * Arabic sentence is built here, from the same catalogue the Tasks tab uses
 * for its badge. That is rule 2 applied to the wire -- a stored or
 * transmitted display label is a label that cannot be reworded without a
 * migration, and a notification queued on a push service for four hours would
 * otherwise arrive with wording the app no longer uses.
 *
 * Pure, and separate from `sw.ts`, because a service worker cannot be
 * unit-tested: it has no DOM, no module graph a test runner will load, and
 * the only way to exercise it is to install it in a browser. Everything
 * decidable without a browser lives here instead.
 */

export interface DuePayload {
  kind: "due-tasks";
  overdue: number;
  dueToday: number;
  noteId: string | null;
  language: string;
}

export interface Notification {
  title: string;
  body: string;
  /** Where a tap lands. The note id is carried so the app can open that task. */
  url: string;
  language: string;
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
  return { title: t.t("appTitle"), body: "", url: "/?tab=tasks", language };
}

/** A payload that did not come from this project's own sender is not rendered. */
export function isDuePayload(value: unknown): value is DuePayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<DuePayload>;
  return (
    p.kind === "due-tasks" &&
    typeof p.overdue === "number" &&
    typeof p.dueToday === "number" &&
    typeof p.language === "string"
  );
}

/**
 * Build the notification from a payload.
 *
 * The body reuses `tasksDueSoonCount` -- the plural the badge already uses for
 * its accessible name, correct across all six Arabic categories via
 * `Intl.PluralRules`. Overdue and due-today are summed rather than reported
 * separately: the count is the reason to open the app, and the app itself
 * draws the distinction the moment you do (SB-050's `متأخرة` chip).
 */
export function toNotification(payload: DuePayload): Notification {
  const t = createTranslator(payload.language);
  const total = payload.overdue + payload.dueToday;
  return {
    title: t.t("pushDueTitle"),
    body: t.plural("tasksDueSoonCount", total),
    url: payload.noteId ? `/?tab=tasks&note=${payload.noteId}` : "/?tab=tasks",
    language: payload.language,
  };
}
