/**
 * POST /functions/v1/search
 * Body: { q: string, lang?: string, mode?: 'hybrid'|'semantic'|'lexical',
 *         categories?: string[], limit?: number }
 *
 * Embeds the query, then hands both the raw text and the vector to the
 * search_notes RPC, which fuses lexical and semantic results with RRF.
 *
 * The fusion lives in SQL rather than here on purpose: doing it in TypeScript
 * would mean shipping two full candidate sets over the wire just to merge and
 * discard most of them.
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, recordJob, serviceClient, userClient } from "../_shared/supabase.ts";
import { resolveLanguage, SUPPORTED } from "../_shared/language.ts";
import { embeddingProvider } from "../_shared/providers.ts";

type Mode = "hybrid" | "semantic" | "lexical";
const MODES: Mode[] = ["hybrid", "semantic", "lexical"];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  let language = "ar";

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const supabase = userClient(req);
    const user = await authenticate(supabase);
    const body = await req.json().catch(() => ({}));

    const resolved = resolveLanguage({
      explicit: body.lang,
      profile: user.uiLocale,
      acceptLanguage: req.headers.get("accept-language"),
    });
    language = resolved.language;

    const query = String(body.q ?? "").trim();
    if (!query) throw new HttpError(400, "query_required");

    const mode: Mode = MODES.includes(body.mode) ? body.mode : "hybrid";
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);

    // Only embed when an arm that needs a vector is actually running.
    // A lexical-only search should not pay an embedding round trip.
    let vector: number[] | null = null;
    if (mode === "hybrid" || mode === "semantic") {
      const embedder = embeddingProvider();
      const started = Date.now();
      // "query" input type, not "document" -- Cohere embeds the two
      // asymmetrically and using the wrong one measurably degrades recall.
      const [v] = await embedder.embed([query], "query");
      vector = v;

      await recordJob(
        serviceClient(),
        {
          userId: user.id,
          stage: "embed",
          language,
          provider: embedder.name,
          model: embedder.model,
          latencyMs: Date.now() - started,
        },
        "succeeded",
      );
    }

    // SECURITY INVOKER RPC -- runs under the caller's RLS, so results are
    // scoped to this user by the database rather than by a filter we could
    // forget to write.
    const { data, error } = await supabase.rpc("search_notes", {
      p_query: query,
      p_language: language,
      p_embedding: vector ? JSON.stringify(vector) : null,
      p_mode: mode,
      p_categories: Array.isArray(body.categories) && body.categories.length
        ? body.categories
        : null,
      p_limit: limit,
    });

    if (error) {
      console.error("search_rpc_failed", error.message);
      throw new HttpError(500, "search_failed");
    }

    return json(
      { query, mode, results: data ?? [] },
      { language, direction: SUPPORTED[language]?.direction ?? "rtl" },
    );
  } catch (err) {
    return errorResponse(err, language);
  }
});
