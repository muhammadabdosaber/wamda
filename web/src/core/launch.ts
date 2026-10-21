/**
 * Where a launch URL asks the app to land.
 *
 * A notification tap opens `/?tab=tasks&note=<id>` (see `pushMessage.ts`).
 * Until this existed the app ignored the query entirely and always opened on
 * Capture -- the link was built, sent, and dropped on the floor.
 *
 * Pure so it can be tested without a browser. Anything unrecognised is
 * ignored rather than trusted: the URL is user-editable, and a bad `tab`
 * must not leave the app on a screen that does not exist.
 */
export const TABS = ["capture", "notes", "tasks", "search", "digest"] as const;
export type Tab = (typeof TABS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function launchTarget(search: string): { tab: Tab | null; noteId: string | null } {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const note = params.get("note");
  return {
    tab: tab && (TABS as readonly string[]).includes(tab) ? (tab as Tab) : null,
    // A note only means something on the Tasks screen, which is where it opens.
    noteId: tab === "tasks" && note && UUID.test(note) ? note : null,
  };
}
