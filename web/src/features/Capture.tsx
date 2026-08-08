import { useEffect, useRef, useState } from "react";

import type { Translator } from "../i18n";
import { capture, pendingCount } from "../data/outbox";
import { sync } from "../data/api";

/** Inline so no icon library is added just for two glyphs. */
function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m15.5 4.5 4 4L8 20H4v-4L15.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The capture surface. One job: get a thought out of the user's head and into
 * durable storage with as little ceremony as possible.
 *
 * Rules enforced here:
 *   * Saving NEVER awaits the network. The only thing the UI waits on is the
 *     IndexedDB write -- that write IS the durability guarantee, and the
 *     moment it returns the thought cannot be lost. `sync()` runs behind it,
 *     unawaited: it drains the entire outbox, and each note in that queue
 *     costs a round trip plus an enrichment call, so awaiting it would make
 *     the next capture wait on every note captured since the last successful
 *     sync. Capture latency is storage latency (ADR-0001).
 *   * The confirmation is the note itself. The notes screen renders unsynced
 *     notes straight from the outbox, so handing off to it after a save shows
 *     the thought that was just captured -- online or off.
 *   * The textarea is autofocused, so the default path is "open, type".
 *   * There is no category, tag, or folder picker. Filing is the AI's job --
 *     asking the user to file is what makes every other notes app fail this
 *     user.
 */
export function Capture({
  t,
  language,
  onSaved,
}: {
  t: Translator;
  language: string;
  /** Called once a note has landed durably. Does not wait for the network. */
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  // Picking the "text" card reveals the composer in place of the idle mark;
  // picking "voice" skips straight to recording without this flag ever
  // flipping. Resets to false on every mount, which is exactly what happens
  // when the user leaves and returns to this tab (App.tsx only renders
  // Capture while it's the active tab) -- so the idle screen is always what
  // greets a fresh visit, never a composer left open from last time.
  const [showComposer, setShowComposer] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const canRecord =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";

  useEffect(() => {
    void pendingCount().then(setPending);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function refresh() {
    setPending(await pendingCount());
  }

  async function saveText() {
    const value = text.trim();
    if (!value || saving) return;

    setSaving(true);
    setFailed(false);
    try {
      // Durable first, clear the field second. If the tab is closed between
      // this write and the sync below, the note is still in IndexedDB and the
      // outbox picks it up on next launch.
      await capture({ source: "text", language, text: value });
      setText("");
      await refresh();
    } catch {
      // The one failure that must never be silent: the thought is nowhere.
      // The text stays in the box so it can be retried or copied out.
      setFailed(true);
      return;
    } finally {
      setSaving(false);
      textarea.current?.focus();
    }

    // Deliberately not awaited -- see the note at the top of this file. The
    // notes screen shows this note from the outbox in the meantime, and
    // refreshes itself when the sync lands.
    void sync().then(refresh);

    onSaved?.();
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Opus in WebM: roughly a tenth of WAV at speech quality. Upload time
    // dominates perceived transcription latency far more than the ASR call
    // does. Safari produces mp4/aac instead -- the server takes both, so the
    // container is left to the browser rather than forced.
    const mr = new MediaRecorder(stream);
    chunks.current = [];

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks.current, { type: mr.mimeType });

      setSaving(true);
      setFailed(false);
      try {
        await capture({ source: "voice", language, audio: blob });
        await refresh();
      } catch {
        // A recording that failed to store is unrecoverable -- there is no
        // textarea still holding it. Say so rather than returning silently to
        // an idle screen.
        setFailed(true);
        return;
      } finally {
        setSaving(false);
      }

      void sync().then(refresh);
      onSaved?.();
    };

    mr.start();
    recorder.current = mr;
    setRecording(true);
  }

  function stopRecording() {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }

  // Three mutually exclusive screens. Recording started from the idle voice
  // card (showComposer still false) gets its own full-screen stop control;
  // recording toggled from inside the composer (the small mic button beside
  // Save) stays on the "writing" screen and shows the inline status line
  // instead -- unchanged from before this redesign.
  const view: "idle" | "writing" | "recording" =
    recording && !showComposer ? "recording" : showComposer ? "writing" : "idle";

  return (
    <>
      {!online && <div className="banner">{t.t("offline")}</div>}

      {view === "idle" && (
        <div className="capture-idle">
          <h2 className="capture-idle-title">{t.t("captureIdleTitle")}</h2>
          <p className="capture-idle-subtitle">{t.t("captureIdleSubtitle")}</p>

          <div className="capture-plus-wrap">
            <span className="capture-plus-ring" aria-hidden="true" />
            <span className="capture-plus-ring capture-plus-ring-delay" aria-hidden="true" />
            {/* Deliberately not a button -- it signals "ready to capture",
                it does not start anything. The two cards below choose HOW. */}
            <span className="capture-plus" aria-hidden="true">
              <PlusIcon />
            </span>
          </div>

          <div className="capture-cards">
            <button
              type="button"
              className="capture-card"
              onClick={() => void startRecording()}
              disabled={!canRecord || saving}
            >
              <span className="capture-card-icon"><MicIcon /></span>
              <span className="capture-card-label">{t.t("captureCardVoiceLabel")}</span>
              <span className="capture-card-hint">{t.t("captureCardVoiceHint")}</span>
            </button>

            <button
              type="button"
              className="capture-card"
              onClick={() => setShowComposer(true)}
              disabled={saving}
            >
              <span className="capture-card-icon"><PencilIcon /></span>
              <span className="capture-card-label">{t.t("captureCardTextLabel")}</span>
              <span className="capture-card-hint">{t.t("captureCardTextHint")}</span>
            </button>
          </div>

          {!canRecord && (
            // Honest degradation rather than a card that does nothing.
            // MediaRecorder is still absent or partial on some iOS versions.
            <p className="muted capture-unsupported">
              {t.t("captureUnsupported")}
            </p>
          )}
        </div>
      )}

      {view === "writing" && (
        <>
          <textarea
            ref={textarea}
            className="capture-input"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.t("captureHint")}
            // The composer follows the UI direction because the user is writing
            // in their own language. Rendered note BODIES elsewhere set their own
            // dir from the language the pipeline detected.
            aria-label={t.t("captureHint")}
            // `readOnly`, not `disabled`: a disabled field loses focus, which on a
            // phone closes the keyboard. This window is one IndexedDB write long,
            // so a dropped keyboard would cost more than the race it prevents.
            readOnly={saving}
            aria-busy={saving}
          />

          <div className="row">
            <button className="btn" onClick={() => void saveText()} disabled={saving || !text.trim()}>
              {saving ? t.t("captureSaving") : t.t("captureSave")}
            </button>

            {canRecord && (
              // Compact and icon-only, sitting beside Save rather than stacked
              // in its own full-width row below -- one row to scan, not two.
              <button
                className={recording ? "btn-icon recording" : "btn-icon"}
                onClick={() => (recording ? stopRecording() : void startRecording())}
                aria-label={recording ? t.t("captureStop") : t.t("captureVoice")}
                title={recording ? t.t("captureStop") : t.t("captureVoice")}
                disabled={saving}
              >
                {recording ? <StopIcon /> : <MicIcon />}
              </button>
            )}
          </div>

          {recording && (
            // Explicit confirmation that recording is live -- the icon-only
            // button alone isn't enough feedback for a state this important.
            <p className="recording-status">
              <span className="recording-dot" aria-hidden="true" />
              {t.t("captureRecording")}
            </p>
          )}
        </>
      )}

      {view === "recording" && (
        <div className="capture-idle">
          <h2 className="capture-idle-title">{t.t("captureRecording")}</h2>

          <div className="capture-plus-wrap">
            <span className="capture-plus-ring capture-plus-ring-danger" aria-hidden="true" />
            <span className="capture-plus-ring capture-plus-ring-danger capture-plus-ring-delay" aria-hidden="true" />
            <button
              type="button"
              className="capture-plus capture-plus-recording"
              onClick={stopRecording}
              aria-label={t.t("captureStop")}
              title={t.t("captureStop")}
            >
              <StopIcon />
            </button>
          </div>

          <p className="recording-status">
            <span className="recording-dot" aria-hidden="true" />
            {t.t("captureStop")}
          </p>
        </div>
      )}

      {failed && (
        // Only ever the local write. `sync()` handles its own failures and
        // leaves the note queued, which is not something to alarm anyone about.
        <p className="error-text capture-error">
          {t.t("errorCaptureFailed")}
        </p>
      )}

      {pending > 0 && (
        // Quiet, non-alarming. Never a red badge -- a badge turns "your phone
        // is offline" into something that reads as the user's failure.
        <p className="muted capture-pending">
          {t.plural("pendingSync", pending)}
        </p>
      )}
    </>
  );
}
