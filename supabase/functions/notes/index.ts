/**
 * Note capture and audio upload registration.
 *
 *   POST /functions/v1/notes            -> create (idempotent on client_id)
 *   POST /functions/v1/notes/audio-url  -> signed upload URL for a voice note
 *   GET  /functions/v1/notes            -> keyset-paginated timeline
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, userClient } from "../_shared/supabase.ts";
import { resolveLanguage, SUPPORTED } from "../_shared/language.ts";

interface TimelineRow {
  id: string;
  client_id: string;
  source: "voice" | "text";
  status: string;
  input_language: string;
  detected_language: string | null;
  client_created_at: string;
  action_dismissed_at: string | null;
  completed_at: string | null;
  note_enrichments: Array<{
    title: string | null;
    summary: string;
    category: string;
    priority: string;
    suggested_action: string;
    action_due_at: string | null;
    language: string;
  }>;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  let language = "ar";

  try {
    const supabase = userClient(req);
    const user = await authenticate(supabase);
    const url = new URL(req.url);
    const isAudioUrl = url.pathname.endsWith("/audio-url");

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const resolved = resolveLanguage({
      explicit: body.lang ?? url.searchParams.get("lang"),
      profile: user.uiLocale,
      acceptLanguage: req.headers.get("accept-language"),
    });
    language = resolved.language;
    const direction = SUPPORTED[language]?.direction ?? "rtl";

    // -----------------------------------------------------------------------
    // GET /notes -- timeline
    // -----------------------------------------------------------------------
    if (req.method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
      const cursor = url.searchParams.get("cursor");

      // Keyset pagination, not OFFSET. OFFSET re-scans and discards every
      // skipped row, so page 50 costs 50x page 1 -- and it silently skips or
      // repeats rows when notes sync in while the user is scrolling.
      let q = supabase
        .from("notes")
        .select(
          // Deliberately NOT selecting raw_text: the timeline renders
          // summaries, and a full note body per row is the difference between
          // a 30 KB and a 900 KB response on a long scroll.
          "id, client_id, source, status, input_language, detected_language, " +
            "client_created_at, action_dismissed_at, completed_at, note_enrichments(title, summary, category, priority, " +
            "suggested_action, action_due_at, language)",
        )
        // Every non-archived note, NOT just `ready` ones. A note that synced
        // but whose enrichment stalled or failed is still the user's note and
        // must stay visible -- filtering to `ready` made it vanish from both
        // the timeline and the outbox, so the user watched a note they just
        // captured disappear (SB-032). The client labels a note with no
        // enrichment as processing or failed from its `status`.
        .is("archived_at", null)
        .eq("note_enrichments.language", language)
        .order("client_created_at", { ascending: false })
        .limit(limit);

      if (cursor) q = q.lt("client_created_at", cursor);

      // PostgREST cannot infer a row type through an embedded relation, so
      // state it. Without this the result is a union that includes an error
      // shape and every field access is a type error.
      const { data, error } = await q.returns<TimelineRow[]>();
      if (error) throw new HttpError(500, "notes_list_failed");

      const next = data && data.length === limit
        ? data[data.length - 1].client_created_at
        : null;

      return json({ notes: data ?? [], next_cursor: next }, { language, direction });
    }

    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    // -----------------------------------------------------------------------
    // POST /notes/audio-url
    // -----------------------------------------------------------------------
    if (isAudioUrl) {
      const noteId: string | undefined = body.note_id;
      if (!noteId) throw new HttpError(400, "note_id_required");

      const { data: note } = await supabase
        .from("notes")
        .select("id")
        .eq("id", noteId)
        .maybeSingle();
      if (!note) throw new HttpError(404, "note_not_found");

      // Path is <user_id>/<note_id>.<ext>. The leading segment is what the
      // storage RLS policy checks, so ownership is enforced by the path shape
      // itself rather than by trusting the caller.
      const ext = String(body.ext ?? "m4a").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "m4a";
      const path = `${user.id}/${noteId}.${ext}`;

      // The audio bytes go client -> Storage directly. Routing a 25 MB upload
      // through an Edge Function would burn function time and memory for no
      // benefit, and Edge request size limits would cap recording length.
      const { data: signed, error } = await supabase.storage
        .from("audio")
        .createSignedUploadUrl(path);

      if (error) throw new HttpError(500, "signed_url_failed");

      await supabase
        .from("notes")
        .update({ audio_path: path, status: "queued" })
        .eq("id", noteId);

      return json(
        { note_id: noteId, path, upload: signed },
        { language, direction },
      );
    }

    // -----------------------------------------------------------------------
    // POST /notes -- capture
    // -----------------------------------------------------------------------
    const clientId: string | undefined = body.client_id;
    if (!clientId) {
      // Required, not generated server-side. The whole point is that the
      // client minted it before it had connectivity; generating one here
      // would make every offline retry a new note.
      throw new HttpError(400, "client_id_required");
    }

    const source = body.source === "voice" ? "voice" : "text";
    if (source === "text" && !String(body.text ?? "").trim()) {
      throw new HttpError(400, "text_required");
    }

    // SB-020: the client's own measured IndexedDB-durable latency, forwarded
    // as-is. Not trusted for anything but a metrics view -- an absent or
    // malformed value just means one fewer data point, never a rejected
    // capture.
    const latencyRaw = body.capture_latency_ms;
    const captureLatencyMs =
      typeof latencyRaw === "number" && Number.isFinite(latencyRaw) && latencyRaw >= 0
        ? Math.round(latencyRaw)
        : null;

    const { data: noteId, error } = await supabase.rpc("capture_note", {
      p_client_id: clientId,
      p_source: source,
      p_language: language,
      p_raw_text: body.text ?? null,
      p_client_created: body.client_created_at ?? new Date().toISOString(),
      p_capture_latency_ms: captureLatencyMs,
    });

    if (error) {
      console.error("capture_failed", error.message);
      throw new HttpError(500, "capture_failed");
    }

    return json(
      { note_id: noteId, client_id: clientId, source },
      { status: 201, language, direction },
    );
  } catch (err) {
    return errorResponse(err, language);
  }
});
