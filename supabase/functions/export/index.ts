/**
 * GET /functions/v1/export
 *
 * SB-014: one call returns every note, enrichment, and tag the caller owns.
 * Runs entirely under the CALLER's client (RLS), never the service role --
 * the same reasoning `functions/notes` GET already uses. There is no
 * user-id filter anywhere in this file because there does not need to be
 * one: RLS is the reason no other user's data is reachable here, not a
 * `.eq("user_id", ...)` someone could forget.
 *
 * Unlike the timeline, this is NOT paginated and DOES include `raw_text` and
 * archived notes -- a data export that silently drops archived notes or
 * truncates bodies is not a complete export. Shape documented in
 * docs/03-api.md.
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, userClient } from "../_shared/supabase.ts";
import { resolveLanguage, SUPPORTED } from "../_shared/language.ts";

interface ExportRow {
  id: string;
  client_id: string;
  source: "voice" | "text";
  status: string;
  input_language: string;
  detected_language: string | null;
  raw_text: string | null;
  client_created_at: string;
  created_at: string;
  archived_at: string | null;
  completed_at: string | null;
  note_enrichments: Array<{
    language: string;
    title: string | null;
    summary: string;
    category: string;
    priority: string;
    suggested_action: string;
    action_due_at: string | null;
    context: Record<string, unknown>;
    model: string;
  }>;
  note_tags: Array<{
    tags: {
      slug: string;
      tag_labels: Array<{ language: string; label: string }>;
    } | null;
  }>;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  let language = "ar";

  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed");

    const supabase = userClient(req);
    const user = await authenticate(supabase);
    const url = new URL(req.url);

    const resolved = resolveLanguage({
      explicit: url.searchParams.get("lang"),
      profile: user.uiLocale,
      acceptLanguage: req.headers.get("accept-language"),
    });
    language = resolved.language;
    const direction = SUPPORTED[language]?.direction ?? "rtl";

    const { data, error } = await supabase
      .from("notes")
      .select(
        "id, client_id, source, status, input_language, detected_language, raw_text, " +
          "client_created_at, created_at, archived_at, completed_at, " +
          "note_enrichments(language, title, summary, category, priority, suggested_action, action_due_at, context, model), " +
          "note_tags(tags(slug, tag_labels(language, label)))",
      )
      .order("client_created_at", { ascending: true })
      .returns<ExportRow[]>();

    if (error) throw new HttpError(500, "export_failed");

    const notes = (data ?? []).map((row) => ({
      id: row.id,
      client_id: row.client_id,
      source: row.source,
      status: row.status,
      input_language: row.input_language,
      detected_language: row.detected_language,
      raw_text: row.raw_text,
      client_created_at: row.client_created_at,
      created_at: row.created_at,
      archived_at: row.archived_at,
      completed_at: row.completed_at,
      enrichments: row.note_enrichments,
      tags: row.note_tags
        .map((nt) => nt.tags)
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .map((t) => ({
          slug: t.slug,
          labels: Object.fromEntries(t.tag_labels.map((l) => [l.language, l.label])),
        })),
    }));

    return json(
      { exported_at: new Date().toISOString(), user_id: user.id, notes },
      { language, direction },
    );
  } catch (err) {
    return errorResponse(err, language);
  }
});
