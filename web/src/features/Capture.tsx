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

/**
 * The capture surface. One job: get a thought out of the user's head and into
 * durable storage with as little ceremony as possible.
 *
 * Rules enforced here:
 *   * The local write NEVER awaits the network -- capture() durably lands in
 *     IndexedDB first, unconditionally, so a dropped connection never loses a
 *     thought. Only AFTER that does this component wait on `sync()`, purely
 *     so the UI can show a real "saved" state and hand off to the notes list
 *     with the note actually in it, rather than lying about being done.
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
  /** Called once a note has landed durably and sync has been attempted. */
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
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
    try {
      // Durable first, clear the field second. If the tab is closed between
      // the write and the sync below, the note is still in IndexedDB and the
      // outbox picks it up on next launch -- nothing here weakens that.
      await capture({ source: "text", language, text: value });
      setText("");
      await refresh();

      // Awaited (unlike the outbox write above) so the caller can hand off to
      // a screen that actually shows the note, and so the textarea stays
      // locked for the one moment where typing a second note could race the
      // first one's save.
      await sync();
      await refresh();
    } finally {
      setSaving(false);
      textarea.current?.focus();
    }

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
      try {
        await capture({ source: "voice", language, audio: blob });
        await refresh();
        await sync();
        await refresh();
      } finally {
        setSaving(false);
      }
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

  return (
    <>
      {!online && <div className="banner">{t.t("offline")}</div>}

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
        // Locked while the previous note is being registered -- otherwise a
        // second thought typed mid-save could get folded into or race the
        // first one.
        disabled={saving}
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

      {saving && (
        // The one moment capture is NOT instant end-to-end: local write plus
        // the sync attempt that gets the note onto the server so the notes
        // list the user is about to land on actually shows it.
        <p className="muted" style={{ marginBlockStart: 14, textAlign: "center" }}>
          {t.t("captureSaving")}
        </p>
      )}

      {!canRecord && (
        // Honest degradation rather than a button that does nothing.
        // MediaRecorder is still absent or partial on some iOS versions.
        <p className="muted" style={{ marginBlockStart: 12 }}>
          {t.t("captureUnsupported")}
        </p>
      )}

      {recording && (
        // Explicit confirmation that recording is live -- the icon-only
        // button alone isn't enough feedback for a state this important.
        <p className="recording-status">
          <span className="recording-dot" aria-hidden="true" />
          {t.t("captureRecording")}
        </p>
      )}

      {pending > 0 && (
        // Quiet, non-alarming. Never a red badge -- a badge turns "your phone
        // is offline" into something that reads as the user's failure.
        <p className="muted" style={{ marginBlockStart: 20, textAlign: "center" }}>
          {t.plural("pendingSync", pending)}
        </p>
      )}
    </>
  );
}
