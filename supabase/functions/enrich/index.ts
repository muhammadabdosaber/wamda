/**
 * POST /functions/v1/enrich
 * Body: { note_id: string, lang?: string, force?: boolean }
 *
 * Runs stages 3-5 of the pipeline for one note: enrichment, embedding, and
 * relation detection. The pipeline itself lives in `_shared/pipeline.ts`,
 * shared with the `sweep` worker, which calls it for notes nobody is
 * waiting on. This handler's job is just: authenticate, verify the note
 * belongs to the caller, resolve language, and shape the response.
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, serviceClient, userClient } from "../_shared/supabase.ts";
import { resolveLanguage, SUPPORTED } from "../_shared/language.ts";
import { runEnrichment } from "../_shared/pipeline.ts";

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

    // Read under the CALLER's RLS. If the note id belongs to someone else,
    // this returns nothing -- the pipeline never gets a chance to touch it.
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .select("id, raw_text, input_language, client_created_at, status")
      .eq("id", noteId)
      .maybeSingle();

    if (noteErr) throw new HttpError(500, "note_lookup_failed");
    if (!note) throw new HttpError(404, "note_not_found");
    if (!note.raw_text?.trim()) throw new HttpError(409, "note_has_no_text");

    const admin = serviceClient();
    const result = await runEnrichment({
      admin,
      userId: user.id,
      noteId,
      language,
      rawText: note.raw_text,
      capturedAt: note.client_created_at,
      timezone: user.timezone,
      force: Boolean(body.force),
    });

    return json(
      { note_id: noteId, ...result },
      { language, direction: SUPPORTED[language]?.direction ?? "rtl" },
    );
  } catch (err) {
    return errorResponse(err, language);
  }
});
