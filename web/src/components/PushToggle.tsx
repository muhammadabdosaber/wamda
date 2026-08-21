import { useEffect, useState } from "react";

import type { Translator } from "../i18n";
import { disablePush, enablePush, pushState, type PushState } from "../data/push";

/**
 * SB-051. The control that turns closed-app reminders on.
 *
 * It lives on the Tasks screen, and only appears once there is at least one
 * task to be reminded about. That is not decoration: the permission prompt
 * can be shown exactly once, and a browser that has been told "no" will not
 * ask again -- asking on first launch, before the user has any tasks, spends
 * the single chance on someone with nothing to be reminded of.
 *
 * Every state is spelled out rather than collapsed into a disabled button.
 * "Blocked" and "unsupported" look identical to a user and have completely
 * different fixes: one is a browser setting, the other is "add this to your
 * Home Screen first", which is the only way iOS gives a web app push at all.
 */
export function PushToggle({ t }: { t: Translator }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void pushState().then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Nothing to say while the first read is in flight: a control that flickers
  // from "off" to "on" on every visit reads as a bug.
  if (state === null) return null;

  if (state === "unsupported") {
    // Worth saying on iOS Safari, where the API is simply absent in a tab.
    // Silence there looks like a broken app rather than a missing step.
    return <p className="muted push-note">{t.t("pushUnsupported")}</p>;
  }

  if (state === "blocked") {
    return <p className="muted push-note">{t.t("pushBlocked")}</p>;
  }

  const on = state === "on";

  async function toggle() {
    setBusy(true);
    setFailed(false);
    try {
      setState(on ? await disablePush() : await enablePush());
    } catch {
      // The subscription may have been created in the browser even though
      // storing it failed, so the honest report is "not on", not "on".
      setFailed(true);
      setState(await pushState().catch(() => "off" as PushState));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-toggle">
      <button type="button" className="btn secondary push-button" onClick={() => void toggle()} disabled={busy}>
        {on ? t.t("pushDisable") : t.t("pushEnable")}
      </button>
      {on && <p className="muted push-note">{t.t("pushEnabled")}</p>}
      {failed && <p className="muted push-note">{t.t("pushFailed")}</p>}
    </div>
  );
}
