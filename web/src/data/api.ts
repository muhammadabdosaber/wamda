import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { OutboxNote } from "./outbox";
import {
  clearNoteAction,
  markAttempted,
  markSynced,
  pending,
  pendingNoteActions,
  queueNoteAction,
} from "./outbox";

/**
 * The anon key is public by design and safe to ship in a bundle. It is safe
 * ONLY because every table has a Row Level Security policy -- RLS is the
 * authorization layer, not a second line of defence. No service-role key ever
 * reaches this code.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when the build was made without Supabase env vars. */
export const isConfigured = Boolean(url && anonKey);

/**
 * Placeholders when unconfigured, rather than empty strings.
 *
 * `createClient("", "")` THROWS at module scope, which in a bundled app means
 * the whole module graph fails to evaluate and the user gets a blank white
 * page with an error only visible in the console. Falling back to a
 * syntactically valid local URL keeps the shell rendering, so the app can show
 * an actionable "not configured" banner instead of nothing at all.
 */
export const supabase: SupabaseClient = createClient(
  url || "http://127.0.0.1:54421",
  anonKey || "anon-key-not-configured",
);

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** A technical message, not a user-facing one -- for the diagnostic banner in `Capture.tsx`. */
function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface SyncFailure {
  clientId: string;
  message: string;
}

/**
 * `FunctionsHttpError.context` is the raw `Response`, not a parsed body --
 * the SDK's own docs read it with `await error.context.json()`. Reading
 * `.context.error.code` directly (the previous code here) always landed on
 * `undefined`, so every real code from `errorResponse()` -- `rate_limited`,
 * `missing_configuration`, `unauthenticated` -- surfaced to the user as the
 * same generic "internal_error", the diagnostic banner built to report
 * exactly this having no real signal in it.
 */
async function errorCodeFrom(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | undefined)?.context;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.clone().json();
      const code = (body as { error?: { code?: string } } | null)?.error?.code;
      if (code) return code;
    } catch {
      // Non-JSON body (e.g. a relay/network failure) -- fall through.
    }
  }
  return "internal_error";
}

/**
 * Every call carries the resolved language explicitly. The server applies the
 * same precedence, but sending it makes intent unambiguous and keeps
 * optimistic local rendering consistent with what comes back.
 */
async function invoke<T>(
  fn: string,
  body: Record<string, unknown>,
  language: string,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { ...body, lang: language },
    headers: { "Accept-Language": language },
  });

  if (error) throw new ApiError(await errorCodeFrom(error));
  if (data && typeof data === "object" && "error" in data) {
    const code = (data as { error?: { code?: string } }).error?.code;
    throw new ApiError(code ?? "internal_error");
  }
  return data as T;
}

export interface Enrichment {
  title: string | null;
  summary: string;
  category: string;
  priority: string;
  suggested_action: string;
  action_due_at: string | null;
  language: string;
}

export interface TimelineNote {
  id: string;
  client_id: string;
  source: string;
  status: string;
  input_language: string;
  detected_language: string | null;
  client_created_at: string;
  action_dismissed_at: string | null;
  completed_at: string | null;
  note_enrichments: Enrichment[];
}

/** The full note body, fetched on demand for a detail view. */
export interface NoteDetail {
  raw_text: string | null;
  client_created_at: string;
}

export async function captureNote(note: OutboxNote): Promise<string> {
  const res = await invoke<{ note_id: string }>(
    "notes",
    {
      client_id: note.clientId,
      source: note.source,
      text: note.text ?? null,
      client_created_at: note.capturedAt,
      capture_latency_ms: note.captureLatencyMs ?? null,
    },
    note.language,
  );
  return res.note_id;
}

/** Mirrors the `allowed_mime_types` on the `audio` Storage bucket (migration `…000400`). */
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
};

export async function requestAudioUrl(
  noteId: string,
  language: string,
  mimeType: string,
): Promise<{ path: string; upload: { signedUrl: string; token: string; path: string } }> {
  const ext = AUDIO_EXT_BY_MIME[mimeType] ?? "webm";
  return invoke("notes/audio-url", { note_id: noteId, ext }, language);
}

export async function transcribe(noteId: string, language: string) {
  return invoke<{ text: string; needs_review: boolean }>(
    "transcribe",
    { note_id: noteId },
    language,
  );
}

export async function enrich(noteId: string, language: string) {
  return invoke<{ enrichment: Enrichment }>("enrich", { note_id: noteId }, language);
}

export async function search(
  q: string,
  language: string,
  mode: "hybrid" | "semantic" | "lexical" = "hybrid",
) {
  const res = await invoke<{ results: Array<Record<string, unknown>> }>(
    "search",
    { q, mode },
    language,
  );
  return res.results;
}

export async function timeline(language: string, cursor?: string) {
  const params = new URLSearchParams({ lang: language });
  if (cursor) params.set("cursor", cursor);

  const { data, error } = await supabase.functions.invoke(
    `notes?${params.toString()}`,
    { method: "GET", headers: { "Accept-Language": language } },
  );
  if (error) throw new ApiError(await errorCodeFrom(error));
  return data as { notes: TimelineNote[]; next_cursor: string | null };
}

/**
 * SB-028: writes one column on an existing note, local-first like every
 * other mutation in this app. Goes straight through PostgREST under RLS --
 * no vendor call or server-side logic sits between the button and the row.
 *
 * On any failure to reach the server -- offline, or a network error while
 * nominally online (`navigator.onLine` is not trustworthy here either, see
 * `Notes.tsx`) -- the write is queued instead of thrown. The caller (and the
 * optimistic UI update after it) proceeds either way: the difference between
 * "wrote it" and "queued it to write" is invisible to the person who just
 * tapped a button, the same as capturing a note offline already works.
 */
async function writeNoteField(
  noteId: string,
  field: "archived_at" | "action_dismissed_at",
  value: string | null,
): Promise<void> {
  try {
    const { error } = await supabase.from("notes").update({ [field]: value }).eq("id", noteId);
    if (error) throw error;
  } catch {
    await queueNoteAction(noteId, field, value);
  }
}

/**
 * Archives a note -- hides it from the timeline and from search for good.
 */
export async function archiveNote(noteId: string): Promise<void> {
  await writeNoteField(noteId, "archived_at", new Date().toISOString());
}

/**
 * Records that the user responded to a note's suggested-action chip
 * (accepted or ignored) so it stops being offered again. Writes to `notes`,
 * never to `note_enrichments` -- that table is pipeline-output-only, and this
 * column exists precisely so the client has somewhere writable to record its
 * own response without touching AI output.
 */
export async function dismissNoteAction(noteId: string): Promise<void> {
  await writeNoteField(noteId, "action_dismissed_at", new Date().toISOString());
}

/**
 * Marks a task-category note done, or clears it. `completed_at` is a column
 * the client owns (migration 09, scoped grant migration 10) -- distinct from
 * `archived_at`, which removes the note from the timeline for good. A completed
 * task stays a note and stays findable; it is only ticked off the Tasks view.
 */
export async function setNoteCompleted(noteId: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from("notes")
    .update({ completed_at: done ? new Date().toISOString() : null })
    .eq("id", noteId);
  if (error) throw new ApiError("complete_failed");
}

/**
 * Fetches a single note's full body. The timeline deliberately omits
 * `raw_text` -- a full note per row is the difference between a 30 KB and a
 * 900 KB response on a long scroll (see functions/notes) -- so opening one note
 * to read what was actually captured is a separate, single-row read. Goes
 * straight through PostgREST under RLS; no Edge Function is needed.
 */
export async function noteDetail(noteId: string): Promise<NoteDetail> {
  const { data, error } = await supabase
    .from("notes")
    .select("raw_text, client_created_at")
    .eq("id", noteId)
    .single();
  if (error) throw new ApiError("note_fetch_failed");
  return data as NoteDetail;
}

/**
 * Undoes {@link dismissNoteAction}: clears `action_dismissed_at` so the note's
 * suggested-action chips are offered again. This is the reversal behind the
 * undo affordance in the resolved state (SB-033) -- without it, answering a
 * suggestion is irreversible from the UI.
 */
export async function restoreNoteAction(noteId: string): Promise<void> {
  await writeNoteField(noteId, "action_dismissed_at", null);
}

/** Fired on `window` after a sync that actually moved at least one note. */
export const SYNCED_EVENT = "sb:synced";

/**
 * Replays the outbox oldest-first, sequentially.
 *
 * Sequential rather than parallel: a burst after a long offline stretch is
 * exactly the traffic shape that trips per-user rate limits, and there is no
 * user waiting on the Nth note.
 *
 * NOTHING IN THE CAPTURE PATH MAY AWAIT THIS. It walks the whole outbox, and
 * every note in it costs a round trip plus an enrichment call -- after a week
 * offline that is minutes. Capture waits on the IndexedDB write only; this
 * runs behind it and announces itself when it lands.
 */
export async function sync(): Promise<{ synced: number; failures: SyncFailure[] }> {
  if (!navigator.onLine) return { synced: 0, failures: [] };

  // Bail before touching the outbox when there is no session.
  //
  // Without this, every sync attempt while signed out would 401 and increment
  // `attempts` on each queued note. A user who captures for a week before
  // signing in would accumulate a large attempt count on notes that were never
  // actually broken — poisoning the one signal that is supposed to identify
  // genuinely stuck items.
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { synced: 0, failures: [] };

  // SB-028: replay queued archive/dismiss/undo writes before new captures --
  // cheap, single-row updates, unlike a note's capture+enrich round trip, so
  // there is no ordering reason to defer them.
  for (const action of await pendingNoteActions()) {
    try {
      const { error } = await supabase
        .from("notes")
        .update({ [action.field]: action.value })
        .eq("id", action.noteId);
      if (error) throw error;
      await clearNoteAction(action.key);
    } catch {
      // Still unreachable -- leave it queued for the next sync() call.
    }
  }

  let synced = 0;
  const failures: SyncFailure[] = [];
  for (const note of await pending()) {
    try {
      const serverId = await captureNote(note);

      if (note.source === "voice" && note.audio) {
        const { path, upload } = await requestAudioUrl(serverId, note.language, note.audio.type);
        // Direct to Storage under a signed URL. Routing audio through an Edge
        // Function would burn its memory budget and cap recording length at
        // the request size limit.
        //
        // uploadToSignedUrl takes (path, token, body) -- the path, not the
        // signed URL itself, which the SDK reconstructs from it.
        //
        // Storage returns { data, error } here, not a throw -- an unchecked
        // call silently proceeds to `transcribe` against audio that was never
        // actually written (confirmed for real: a rejected upload -- e.g. a
        // codec-qualified mime type Storage's allow-list doesn't match --
        // left the note orphaned with no error anywhere a person would see).
        const { error: uploadError } = await supabase.storage
          .from("audio")
          .uploadToSignedUrl(path, upload.token, note.audio);
        if (uploadError) throw uploadError;
        await transcribe(serverId, note.language);
      }

      await enrich(serverId, note.language).catch(() => {
        // Enrichment failing must not fail the sync. The note is durable on
        // both sides by this point; a background sweep can pick up anything
        // still unenriched.
      });

      await markSynced(note.clientId, serverId);
      synced += 1;
    } catch (err) {
      failures.push({ clientId: note.clientId, message: describeError(err) });
      await markAttempted(note.clientId);
    }
  }

  // Anything rendering outbox rows -- the notes timeline -- needs to learn
  // that some of them are now real, enriched, server-side notes. Since no
  // caller awaits this function, an event is the only way back.
  if (synced > 0) window.dispatchEvent(new Event(SYNCED_EVENT));

  return { synced, failures };
}
