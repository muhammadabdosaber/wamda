/**
 * POST /functions/v1/sweep
 *
 * Service-triggered (pg_cron), not user-facing -- same shape as `digest`.
 * Consumes the two states nothing else consumed:
 *
 *   - notes stranded in `transcribing` / `enriching`. `enrich` and
 *     `transcribe` move a note out of these on every code path they control,
 *     but a killed container, an OOM, or a worker eviction skips the `catch`
 *     entirely and leaves the note there. The timeline only shows `ready`
 *     notes, so a stranded note is gone from the user's view with no error.
 *   - notes sitting in `queued` because the client's post-capture pipeline
 *     call never happened or never landed (offline, tab closed, crash --
 *     `web/src/data/api.ts` deliberately swallows that failure so a sync
 *     never fails on account of enrichment).
 *   - `ready` notes with no `note_embeddings` row for their language: the
 *     marker `enrich` leaves on purpose when its embedding stage degrades
 *     rather than losing an otherwise-successful note.
 *   - notes whose audio has outlived the owning user's own
 *     `audio_retention_days` (SB-009): the Storage object is deleted and
 *     `audio_path` cleared. The note survives with its transcript --
 *     `raw_text` is the durable artifact, keeping the raw recording past its
 *     promised window is storing sensitive data with no ongoing use
 *     (docs/08-security.md).
 *
 * A note that keeps failing (a vendor key left as a placeholder, most
 * plausibly) is retried a bounded number of times and then marked `failed`
 * -- a sweep that reruns the same broken call on every tick forever is an
 * incident of its own.
 */

import { errorResponse, HttpError, json, preflight, requireCronSecret } from "../_shared/http.ts";
import { recordJob, serviceClient } from "../_shared/supabase.ts";
import { runEnrichment, runTranscription } from "../_shared/pipeline.ts";
import { embeddingProvider } from "../_shared/providers.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Stuck longer than this in a non-terminal state => the process died. */
const STUCK_MINUTES = 10;

/**
 * Grace period before retrying a queued note. Lets the client's own
 * post-capture call finish first, so the sweep does not race a note that is
 * simply mid-flight.
 */
const QUEUE_GRACE_MINUTES = 2;

/** Notes processed per stage, per invocation -- bounds one tick's cost and duration regardless of backlog size. */
const BATCH_SIZE = 25;

/** Failed attempts (per note, per stage) before giving up instead of retrying forever. */
const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    // Service-triggered only. The anon key passes the platform's JWT check;
    // this does not accept it.
    requireCronSecret(req);

    const admin = serviceClient();
    const body = await req.json().catch(() => ({}));

    const unstuck = await unstickStale(admin);
    const retried = await retryQueued(admin);
    const { count: embedded, debug } = await backfillEmbeddings(admin, body.forceEmbedBackfill === true);
    const audioPurged = await enforceAudioRetention(admin);

    return json({ unstuck, retried, embedded, audio_purged: audioPurged, debug });
  } catch (err) {
    return errorResponse(err);
  }
});

/** Notes whose process died mid-stage: hand them back to `queued` for the retry pass below. */
async function unstickStale(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();

  const { data, error } = await admin
    .from("notes")
    .update({ status: "queued" })
    .in("status", ["transcribing", "enriching"])
    .lt("updated_at", cutoff)
    .select("id");

  if (error) {
    console.error("sweep_unstick_failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

async function failedAttempts(admin: SupabaseClient, noteId: string, stage: string): Promise<number> {
  const { count } = await admin
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("note_id", noteId)
    .eq("stage", stage)
    .eq("status", "failed");
  return count ?? 0;
}

/** Notes idle in `queued` long enough that no client is still holding them: retry transcription or enrichment. */
async function retryQueued(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - QUEUE_GRACE_MINUTES * 60_000).toISOString();

  const { data: notes, error } = await admin
    .from("notes")
    .select("id, user_id, raw_text, audio_path, input_language, client_created_at")
    .eq("status", "queued")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("sweep_query_failed", error.message);
    return 0;
  }
  if (!notes?.length) return 0;

  let processed = 0;

  for (const note of notes) {
    // A queued note either still needs a transcript (voice, audio uploaded,
    // nothing back yet) or already has text and needs enrichment. Both
    // states set `status = 'queued'` for a reason: text notes are queued at
    // capture, voice notes are queued once their audio finishes uploading.
    const stage = note.raw_text?.trim() ? "enrich" : "transcribe";

    if (stage === "transcribe" && !note.audio_path) {
      // Not reachable under the current constraints (a voice note without
      // text always carries an audio_path), but a note that ends up here
      // anyway is not retryable -- stop it from being picked up every tick.
      await admin.from("notes").update({ status: "failed" }).eq("id", note.id);
      continue;
    }

    const attempts = await failedAttempts(admin, note.id, stage);
    if (attempts >= MAX_ATTEMPTS) {
      await admin.from("notes").update({ status: "failed" }).eq("id", note.id);
      continue;
    }

    try {
      if (stage === "transcribe") {
        await runTranscription({
          admin,
          userId: note.user_id,
          noteId: note.id,
          audioPath: note.audio_path as string,
          language: note.input_language,
        });
      } else {
        const { data: profile } = await admin
          .from("profiles")
          .select("timezone")
          .eq("id", note.user_id)
          .maybeSingle();

        await runEnrichment({
          admin,
          userId: note.user_id,
          noteId: note.id,
          language: note.input_language,
          rawText: note.raw_text as string,
          capturedAt: note.client_created_at,
          timezone: profile?.timezone ?? "Asia/Dubai",
        });
      }
      processed += 1;
    } catch (e) {
      // runTranscription/runEnrichment already recorded the failure and set
      // the note's status -- nothing further to do here. Swallow so one bad
      // note does not stop the rest of the batch.
      console.warn("sweep_retry_failed", {
        note_id: note.id,
        stage,
        error: e instanceof HttpError ? e.code : String(e),
      });
    }
  }

  return processed;
}

/**
 * `ready` notes whose embedding stage degraded: re-embed and re-run relation detection.
 *
 * `force` bypasses the per-note attempt cap below. It exists for exactly the
 * scenario `MAX_ATTEMPTS` itself is meant to survive -- a vendor key missing
 * for days, not a single bad note -- where every affected note hits the cap
 * at the same time and, once the real key is added, would otherwise never
 * retry again on any regular cron tick. Not sent by the cron trigger itself.
 */
async function backfillEmbeddings(
  admin: SupabaseClient,
  force = false,
): Promise<{ count: number; debug?: unknown }> {
  const { data: rows, error } = await admin.rpc("notes_missing_embeddings", { p_limit: BATCH_SIZE });

  if (error) {
    console.error("sweep_embed_query_failed", error.message);
    return { count: 0, debug: { stage: "rpc", error: error.message } };
  }
  if (!rows?.length) return { count: 0, debug: { stage: "no_rows_found" } };

  const failures: unknown[] = [];
  const skipped: unknown[] = [];

  const embedder = embeddingProvider();
  let embedded = 0;

  for (const row of rows as Array<
    { note_id: string; user_id: string; language: string; title: string; summary: string; raw_text: string | null }
  >) {
    const attempts = await failedAttempts(admin, row.note_id, "embed");
    if (attempts >= MAX_ATTEMPTS && !force) {
      skipped.push({ note_id: row.note_id, attempts });
      continue;
    }

    try {
      const content = `${row.title}\n${row.summary}\n\n${row.raw_text ?? ""}`;
      const [vector] = await embedder.embed([content], "document");

      await admin.from("note_embeddings").upsert(
        {
          note_id: row.note_id,
          user_id: row.user_id,
          language: row.language,
          model: embedder.model,
          chunk_index: 0,
          content,
          embedding: JSON.stringify(vector),
        },
        { onConflict: "note_id,language,model,chunk_index" },
      );

      await recordJob(
        admin,
        {
          userId: row.user_id,
          noteId: row.note_id,
          stage: "embed",
          language: row.language,
          provider: embedder.name,
          model: embedder.model,
        },
        "succeeded",
      );

      await admin.rpc("relate_note", {
        p_user_id: row.user_id,
        p_note_id: row.note_id,
        p_language: row.language,
      });

      embedded += 1;
    } catch (e) {
      const errInfo = { note_id: row.note_id, error: e instanceof HttpError ? e.code : String(e) };
      console.warn("sweep_embed_failed", errInfo);
      failures.push(errInfo);
      await recordJob(
        admin,
        {
          userId: row.user_id,
          noteId: row.note_id,
          stage: "embed",
          language: row.language,
          errorCode: e instanceof HttpError ? e.code : "unknown",
        },
        "failed",
      );
    }
  }

  return { count: embedded, debug: { candidates: rows.length, failures, skipped } };
}

/** Notes whose audio has outlived their owner's `audio_retention_days` (SB-009). */
async function enforceAudioRetention(admin: SupabaseClient): Promise<number> {
  const { data: rows, error } = await admin.rpc("notes_audio_expired", { p_limit: BATCH_SIZE });

  if (error) {
    console.error("sweep_audio_retention_query_failed", error.message);
    return 0;
  }
  if (!rows?.length) return 0;

  let purged = 0;

  for (const row of rows as Array<{ note_id: string; user_id: string; audio_path: string }>) {
    // Storage delete, not a SQL delete on storage.objects -- only the
    // Storage API actually removes the underlying bytes; deleting the
    // metadata row directly would orphan the file.
    const { error: removeErr } = await admin.storage.from("audio").remove([row.audio_path]);
    if (removeErr) {
      // Leave audio_path set so the next tick retries -- clearing it here
      // would make an object that failed to delete permanently unreachable
      // (untracked, so nothing would ever try again).
      console.warn("sweep_audio_remove_failed", { note_id: row.note_id, error: removeErr.message });
      continue;
    }

    // The note survives with its transcript -- only audio_path is cleared.
    await admin.from("notes").update({ audio_path: null }).eq("id", row.note_id);
    purged += 1;
  }

  return purged;
}
