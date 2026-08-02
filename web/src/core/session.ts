import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../data/api";

export interface SessionState {
  session: Session | null;
  /** True until the initial session lookup resolves. */
  loading: boolean;
}

/**
 * Current auth session.
 *
 * `loading` exists so the UI can avoid a flash of the signed-out state on
 * launch. `getSession()` reads from local storage and resolves in a tick, but
 * rendering "sign in" for that tick and then swapping to the timeline is a
 * visible flicker every single launch.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    // Covers token refresh and sign-out as well as sign-in, so a session that
    // expires mid-use updates the UI instead of leaving it on a screen whose
    // every request now 401s.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
