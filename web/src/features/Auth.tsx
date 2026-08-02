import { useState } from "react";

import type { Translator } from "../i18n";
import { supabase } from "../data/api";

/**
 * Email OTP sign-in.
 *
 * SIX-DIGIT CODE, NOT A MAGIC LINK — and that choice is specifically about
 * this being a PWA. A magic link opens in the default browser, which is a
 * *different* context from the installed standalone app: the session lands in
 * the browser's storage and the installed app stays signed out. The user taps
 * the link, sees themselves signed in, returns to the app icon, and is still
 * on the sign-in screen. A code is typed into whichever context asked for it,
 * so it cannot leak across.
 *
 * This requires the email template to contain `{{ .Token }}` —
 * `supabase/templates/magic_link.html` does.
 *
 * No password: nothing to remember, nothing to leak, no reset flow to build.
 */
export function Auth({
  t,
  reason,
  onSignedIn,
}: {
  t: Translator;
  reason?: string;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const address = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError(t.t("errorEmailRequired"));
      return;
    }

    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);

    if (err) {
      setError(t.t("errorGeneric"));
      return;
    }
    setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);

    if (err) {
      setError(t.t("errorInvalidCode"));
      return;
    }
    onSignedIn();
  }

  return (
    <section>
      <h2>{t.t("authTitle")}</h2>
      {reason && <p className="muted">{reason}</p>}

      {!sent ? (
        <>
          <label className="field">
            <span className="muted">{t.t("authEmailLabel")}</span>
            <input
              className="search-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              // Email addresses are Latin even in an Arabic UI, so the field
              // is pinned LTR. Left to inherit rtl, the cursor starts on the
              // wrong side and "@example.com" visually reorders as the user
              // types — it looks like the app is corrupting their input.
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoFocus
            />
          </label>

          <button className="btn" onClick={() => void sendCode()} disabled={busy}>
            {busy ? t.t("authSending") : t.t("authSendCode")}
          </button>
        </>
      ) : (
        <>
          <p>{t.t("authCodeSent")}</p>

          <label className="field">
            <span className="muted">{t.t("authCodeLabel")}</span>
            <input
              className="search-input code-input"
              type="text"
              // `one-time-code` lets iOS and Android offer the code straight
              // from the notification, which removes an app switch at the one
              // moment the user is most likely to give up.
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </label>

          <button
            className="btn"
            onClick={() => void verify()}
            disabled={busy || code.length < 6}
          >
            {busy ? t.t("authVerifying") : t.t("authVerify")}
          </button>

          <div className="row">
            <button className="linkbtn" onClick={() => void sendCode()} disabled={busy}>
              {t.t("authResend")}
            </button>
            <button
              className="linkbtn muted"
              onClick={() => {
                setSent(false);
                setCode("");
                setError(null);
              }}
            >
              {t.t("authChangeEmail")}
            </button>
          </div>
        </>
      )}

      {error && <p className="error-text">{error}</p>}

      {/* The reassurance that makes this screen non-blocking. Without it,
          hitting a sign-in wall reads as "your notes are gone". */}
      <p className="muted" style={{ marginBlockStart: 24 }}>
        {t.t("authCaptureAnyway")}
      </p>
    </section>
  );
}
