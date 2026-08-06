/**
 * POST /functions/v1/transcribe
 * Body: { note_id: string, lang?: string }
 *
 * Stage 1 of the pipeline: audio -> text. The pipeline itself lives in
 * `_shared/pipeline.ts`, shared with the `sweep` worker. This handler's job
 * is just: authenticate, verify the note belongs to the caller, resolve
 * language, and shape the response.
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, serviceClient, userClient } from "../_shared/supabase.ts";
import { resolveLanguage, SUPPORTED } from "../_shared/language.ts";
import { runTranscription } from "../_shared/pipeline.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

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
      .select("id, audio_path")
      .eq("id", noteId)
      .maybeSingle();

    if (!note) throw new HttpError(404, "note_not_found");
    if (!note.audio_path) throw new HttpError(409, "note_has_no_audio");

    const admin = serviceClient();
    await enforceRateLimit(admin, user.id, "transcribe", noteId);
    const result = await runTranscription({
      admin,
      userId: user.id,
      noteId,
      audioPath: note.audio_path,
      language,
    });

    return json(
      {
        note_id: noteId,
        text: result.text,
        confidence: result.confidence,
        needs_review: result.needsReview,
        detected: result.detected,
        cached: result.cached,
      },
      { language, direction: SUPPORTED[language]?.direction ?? "rtl" },
    );
  } catch (err) {
    return errorResponse(err, language);
  }
});
