/**
 * POST /functions/v1/transcribe
 * Body: { note_id: string, lang?: string }
 *
 * Stage 1 of the pipeline: audio -> Arabic text.
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, recordJob, serviceClient, userClient } from "../_shared/supabase.ts";
import { detectLanguage, resolveLanguage, SUPPORTED } from "../_shared/language.ts";
import { asrProvider } from "../_shared/providers.ts";

/**
 * Below this, the transcript is flagged for review instead of being fed
 * downstream. Enriching a garbled transcript is worse than not enriching it:
 * it produces a confident, wrong summary, and the user has no way to tell it
 * apart from a correct one -- so the note is quietly lost.
 */
const REVIEW_THRESHOLD = 0.6;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  let language = "ar";

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const supabase = userClient(req);
    const user = await authenticate(supabase);
    const body = await req.json().catch(() => ({}));

    const noteId: string | undefined = body.note_id;
    if (!noteId) throw new HttpError(400, "note_id_required");

    const resolved = resolveLanguage({
      explicit: body.lang,
      profile: user.uiLocale,
      acceptLanguage: req.headers.get("accept-language"),
    });
    language = resolved.language;

    // Read under caller RLS -- a note id belonging to another user resolves
    // to nothing here, before any audio is fetched.
    const { data: note } = await supabase
      .from("notes")
      .select("id, audio_path, raw_text, status")
      .eq("id", noteId)
      .maybeSingle();

    if (!note) throw new HttpError(404, "note_not_found");
    if (!note.audio_path) throw new HttpError(409, "note_has_no_audio");

    // Already transcribed: transcription is billable and slow, so a retry
    // must not re-run it.
    if (note.raw_text?.trim()) {
      return json(
        { note_id: noteId, text: note.raw_text, cached: true },
        { language, direction: resolved.direction },
      );
    }

    const admin = serviceClient();
    await admin.from("notes").update({ status: "transcribing" }).eq("id", noteId);

    const { data: audio, error: dlErr } = await admin.storage
      .from("audio")
      .download(note.audio_path);

    if (dlErr || !audio) {
      // Same trap as `enrich`: the note is already marked `transcribing`, and
      // leaving it there makes it invisible to the timeline with nothing to
      // retry it. Back to `draft` — the audio may simply not have finished
      // uploading yet, which is a retry, not a failure.
      await admin.from("notes").update({ status: "draft" }).eq("id", noteId);
      throw new HttpError(404, "audio_not_found");
    }

    const asr = asrProvider();
    const started = Date.now();

    let result;
    try {
      result = await asr.transcribe(audio, language);
    } catch (e) {
      await admin.from("notes").update({ status: "failed" }).eq("id", noteId);
      await recordJob(
        admin,
        {
          userId: user.id,
          noteId,
          stage: "transcribe",
          language,
          provider: asr.name,
          errorCode: e instanceof HttpError ? e.code : "unknown",
        },
        "failed",
      );
      throw e;
    }

    const latencyMs = Date.now() - started;
    const needsReview = result.confidence < REVIEW_THRESHOLD || !result.text;

    const detected = detectLanguage(result.text);

    await admin
      .from("notes")
      .update({
        raw_text: result.text,
        transcript_confidence: result.confidence,
        detected_language: detected?.language ?? result.detectedLanguage,
        language_confidence: detected?.confidence ?? null,
        // A low-confidence transcript stops here as `draft` so the user is
        // asked to confirm it, rather than being enriched into a plausible
        // summary of something they never said.
        status: needsReview ? "draft" : "queued",
      })
      .eq("id", noteId);

    await recordJob(
      admin,
      {
        userId: user.id,
        noteId,
        stage: "transcribe",
        language,
        provider: result.provider,
        model: result.model,
        latencyMs,
      },
      "succeeded",
    );

    return json(
      {
        note_id: noteId,
        text: result.text,
        confidence: result.confidence,
        needs_review: needsReview,
        detected,
        cached: false,
      },
      { language, direction: SUPPORTED[language]?.direction ?? "rtl" },
    );
  } catch (err) {
    return errorResponse(err, language);
  }
});
