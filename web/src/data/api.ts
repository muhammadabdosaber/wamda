import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { OutboxNote } from "./outbox";
import { markAttempted, markSynced, pending } from "./outbox";

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

  if (error) {
    const details = (error as { context?: { error?: { code?: string } } }).context;
    throw new ApiError(details?.error?.code ?? "internal_error");
  }
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
    },
    note.language,
  );
  return res.note_id;
}

export async function requestAudioUrl(
  noteId: string,
  language: string,
): Promise<{ path: string; upload: { signedUrl: string; token: string; path: string } }> {
  return invoke("notes/audio-url", { note_id: noteId, ext: "webm" }, language);
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
  if (error) throw new ApiError("internal_error");
  return data as { notes: TimelineNote[]; next_cursor: string | null };
}

/**
 * Archives a note -- hides it from the timeline and from search for good.
 * Goes straight through PostgREST, not an Edge Function: `notes` is fully
 * client-writable under RLS (see 04_rls), so there is no vendor call or
 * server-side logic between the button and the row.
 */
export async function archiveNote(noteId: string): Promise<void> {
  const { error } = await supabase
    .from("notes")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) throw new ApiError("archive_failed");
}

/**
 * Records that the user responded to a note's suggested-action chip
 * (accepted or ignored) so it stops being offered again. Writes to `notes`,
 * never to `note_enrichments` -- that table is pipeline-output-only, and this
 * column exists precisely so the client has somewhere writable to record its
 * own response without touching AI output.
 */
export async function dismissNoteAction(noteId: string): Promise<void> {
  const { error } = await supabase
    .from("notes")
    .update({ action_dismissed_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) throw new ApiError("dismiss_failed");
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
  const { error } = await supabase
    .from("notes")
    .update({ action_dismissed_at: null })
    .eq("id", noteId);
  if (error) throw new ApiError("restore_failed");
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
export async function sync(): Promise<number> {
  if (!navigator.onLine) return 0;

  // Bail before touching the outbox when there is no session.
  //
  // Without this, every sync attempt while signed out would 401 and increment
  // `attempts` on each queued note. A user who captures for a week before
  // signing in would accumulate a large attempt count on notes that were never
  // actually broken — poisoning the one signal that is supposed to identify
  // genuinely stuck items.
  const { data } = await supabase.auth.getSession();
  if (!data.session) return 0;

  let synced = 0;
  for (const note of await pending()) {
    try {
      const serverId = await captureNote(note);

      if (note.source === "voice" && note.audio) {
        const { path, upload } = await requestAudioUrl(serverId, note.language);
        // Direct to Storage under a signed URL. Routing audio through an Edge
        // Function would burn its memory budget and cap recording length at
        // the request size limit.
        //
        // uploadToSignedUrl takes (path, token, body) -- the path, not the
        // signed URL itself, which the SDK reconstructs from it.
        await supabase.storage
          .from("audio")
          .uploadToSignedUrl(path, upload.token, note.audio);
        await transcribe(serverId, note.language);
      }

      await enrich(serverId, note.language).catch(() => {
        // Enrichment failing must not fail the sync. The note is durable on
        // both sides by this point; a background sweep can pick up anything
        // still unenriched.
      });

      await markSynced(note.clientId, serverId);
      synced += 1;
    } catch {
      await markAttempted(note.clientId);
    }
  }

  // Anything rendering outbox rows -- the notes timeline -- needs to learn
  // that some of them are now real, enriched, server-side notes. Since no
  // caller awaits this function, an event is the only way back.
  if (synced > 0) window.dispatchEvent(new Event(SYNCED_EVENT));

  return synced;
}
