import { useCallback, useEffect, useState } from "react";

import { dueSoonCount, type DueTask } from "./due";
import { useNow } from "./clock";
import { isConfigured, NOTE_CHANGED_EVENT, SYNCED_EVENT, timeline } from "../data/api";

/**
 * SB-050. How many open tasks are overdue or due today -- the number on the
 * Tasks tab.
 *
 * It fetches the timeline itself rather than waiting for the Tasks screen to
 * report upward, because the whole point is to be visible from Capture, which
 * is the tab the app OPENS on. A count that only appears after you visit the
 * screen you were supposed to be reminded about reminds nobody.
 *
 * That it is a third `timeline()` caller (`Notes.tsx`, `Tasks.tsx`) is the
 * house pattern here, not an oversight: each view owns its own read, and the
 * response is small -- the timeline deliberately omits `raw_text`.
 *
 * Failure is silent by design. No badge is the same thing the user sees when
 * nothing is due, and an error banner over a launch screen would be louder
 * than the fact it is reporting.
 */
export function useDueSoon(language: string, signedIn: boolean): number {
  const [tasks, setTasks] = useState<DueTask[]>([]);
  const now = useNow();

  const load = useCallback(async () => {
    if (!isConfigured || !signedIn) {
      setTasks([]);
      return;
    }
    try {
      const page = await timeline(language);
      setTasks(page.notes);
    } catch {
      setTasks([]);
    }
  }, [language, signedIn]);

  useEffect(() => {
    void load();
    // A note captured offline becomes a task only once it has synced and been
    // enriched, so the sync event is the moment the count can change without
    // anything on screen having changed.
    const reload = () => void load();
    window.addEventListener(SYNCED_EVENT, reload);
    // Ticking a task off is the other way this count changes, and it happens
    // on a screen this hook does not own.
    window.addEventListener(NOTE_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener(SYNCED_EVENT, reload);
      window.removeEventListener(NOTE_CHANGED_EVENT, reload);
    };
  }, [load]);

  // `now` moves when the app returns to the foreground, so a task that came
  // due overnight is counted on the next glance without a refetch.
  return dueSoonCount(tasks, now);
}
