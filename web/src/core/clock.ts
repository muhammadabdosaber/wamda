import { useEffect, useState } from "react";

/**
 * SB-050. "Now", re-read when the app comes back to the foreground.
 *
 * Both the task groups and the badge are answers to "what is due today", and
 * an installed PWA is routinely left open for days -- so a `new Date()` taken
 * once at mount quietly keeps yesterday's idea of today, and a task that came
 * due overnight never surfaces. Refreshing on foreground is what a phone
 * actually does between one glance and the next; a ticking interval would
 * wake the app all night to recompute a number nobody is looking at.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", refresh);
    // `focus` too: switching between two windows on a desktop does not always
    // fire a visibility change, and the desktop PWA is a real target here.
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return now;
}
