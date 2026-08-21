/**
 * SB-050. One definition of "when is this task due", shared by the Tasks screen
 * (which groups by it) and the tab badge (which counts by it). Before this
 * module the rule lived inside `Tasks.tsx` and could only be exercised by
 * rendering the screen; here it is a pure function, so the badge the user
 * actually acts on is covered by `test/due.test.ts` rather than by inspection.
 *
 * `now` is a parameter, never `Date.now()` read inside. The app stays open
 * across midnight, so the caller has to be able to say WHICH now it means --
 * and a function that reads the wall clock cannot be tested honestly.
 */
export type Bucket = "today" | "week" | "later";

/** The fields these functions read. Deliberately narrower than `TimelineNote`:
 *  it keeps the module free of the API layer, and the tests free of fixtures. */
export type DueTask = {
  completed_at: string | null;
  note_enrichments: Array<{ category: string | null; action_due_at: string | null }>;
};

/** Overdue folds into "today": a task past its date needs doing now, not
 *  hiding in a group of its own. (Moved verbatim from `Tasks.tsx` -- the
 *  grouping the user already knows does not change here; only the reach of
 *  the rule does.) */
export function bucketOf(due: string | null, now: Date): Bucket {
  if (!due) return "later";
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const at = new Date(due).getTime();
  if (at <= endOfToday) return "today";
  if (at <= endOfToday + 7 * 24 * 60 * 60 * 1000) return "week";
  return "later";
}

/** Past its moment, not merely due today. This is the distinction the screen
 *  could not draw before: a task three days late and one due tonight sit in
 *  the same group, and only this tells them apart. */
export function isOverdue(due: string | null, now: Date): boolean {
  if (!due) return false;
  return new Date(due).getTime() < now.getTime();
}

/**
 * What the badge shows: open tasks that are overdue or due today.
 *
 * Completed tasks are excluded, and so is anything with no date -- a task the
 * model could not date is not urgent by omission. A badge that is never zero
 * is noise, and noise is the one thing this product exists to remove.
 */
export function dueSoonCount(notes: readonly DueTask[], now: Date): number {
  let count = 0;
  for (const note of notes) {
    if (note.completed_at) continue;
    const e = note.note_enrichments[0];
    if (!e || e.category !== "task") continue;
    if (bucketOf(e.action_due_at, now) === "today") count += 1;
  }
  return count;
}
