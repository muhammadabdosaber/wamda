/**
 * POST /functions/v1/enrich
 * Body: { note_id: string, lang?: string, force?: boolean }
 *
 * Runs stages 3-5 of the pipeline for one note: enrichment, embedding, and
 * relation detection.
 *
 * Enrichment is ONE model call, not six. Summary, category, tags, priority,
 * suggested action, and extracted context all come back from a single
 * structured-output request. Six calls would be six times the latency, six
 * times the cost, and six chances to disagree with each other about what the
 * note says.
 */

// TODO: pin this once `deno cache` has resolved a known-good version.
import Anthropic from "npm:@anthropic-ai/sdk";

import { errorResponse, HttpError, json, preflight, requireEnv } from "../_shared/http.ts";
import { authenticate, recordJob, serviceClient, userClient } from "../_shared/supabase.ts";
import { detectLanguage, resolveLanguage, SUPPORTED } from "../_shared/language.ts";
import { embeddingProvider } from "../_shared/providers.ts";
import {
  ENRICHMENT_MODEL,
  ENRICHMENT_SCHEMA,
  type Enrichment,
  PROMPT_VERSION,
  systemPrompt,
  userTurn,
} from "../_shared/enrichment.ts";

/** Claude Opus 5, USD per million tokens. */
const PRICING = {
  input: 5.0,
  output: 25.0,
  cacheWrite: 6.25, // 1.25x input
  cacheRead: 0.5, //  0.10x input
};

/** Fields are nullable on the SDK's usage type, not merely optional. */
function costUsd(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  const m = 1_000_000;
  return (
    ((u.input_tokens ?? 0) * PRICING.input +
      (u.output_tokens ?? 0) * PRICING.output +
      (u.cache_creation_input_tokens ?? 0) * PRICING.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICING.cacheRead) /
    m
  );
}

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

    // Pulled out before the pipeline closure below. TypeScript does not carry
    // the null-narrowing above into a nested function, and widening these back
    // to `string | null` there would mean re-checking what has already been
    // validated.
    const rawText: string = note.raw_text;
    const capturedAt: string = note.client_created_at;

    const admin = serviceClient();

    // Idempotency. Enrichment is the expensive stage; a retried request, a
    // double-tap, or an at-least-once queue delivery must not pay for it
    // twice. Keyed on prompt_version so a prompt change legitimately re-runs.
    if (!body.force) {
      const { data: existing } = await supabase
        .from("note_enrichments")
        .select("*")
        .eq("note_id", noteId)
        .eq("language", language)
        .eq("prompt_version", PROMPT_VERSION)
        .maybeSingle();

      if (existing) {
        return json(
          { note_id: noteId, enrichment: existing, cached: true },
          { language, direction: resolved.direction },
        );
      }
    }

    await admin.from("notes").update({ status: "enriching" }).eq("id", noteId);

    // From here on the note is in a NON-TERMINAL state. Every exit path below
    // must move it out of `enriching`, or the note becomes invisible: the
    // timeline filters on `status = 'ready'`, so a stranded note is gone from
    // the user's view with no error and no way back.
    //
    // This is not hypothetical — it happened on the first real run. The
    // function threw on a missing API key and left two notes stuck. A network
    // blip or a 502 would do exactly the same in production.
    try {
      return await runPipeline();
    } catch (err) {
      // A refusal is terminal: re-running the same note against the same
      // prompt will refuse again. Anything else is transient, so the note
      // returns to `queued` where a retry or sweep can pick it up.
      const terminal = err instanceof HttpError && err.code === "enrichment_refused";
      await admin
        .from("notes")
        .update({ status: terminal ? "failed" : "queued" })
        .eq("id", noteId);

      await recordJob(
        admin,
        {
          userId: user.id,
          noteId,
          stage: "enrich",
          language,
          provider: "anthropic",
          model: ENRICHMENT_MODEL,
          errorCode: err instanceof HttpError ? err.code : "unknown",
        },
        "failed",
      );
      throw err;
    }

    // ---------------------------------------------------------------------
    // Stage 3: enrichment
    // ---------------------------------------------------------------------
    async function runPipeline(): Promise<Response> {
    const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
    const started = Date.now();

    const response = await anthropic.beta.messages.create({
      model: ENRICHMENT_MODEL,
      max_tokens: 8192,
      // Thinking is on by default on Opus 5 and max_tokens caps thinking +
      // output together. 8192 leaves headroom so a note that provokes some
      // reasoning cannot truncate the JSON body mid-object.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ENRICHMENT_SCHEMA },
      },
      // Server-side fallback: if a safety classifier declines the request,
      // Anthropic re-runs it on a fallback model inside the same call instead
      // of handing back an empty response. "default" routes by refusal
      // category, so there is no pinned model to maintain.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text: systemPrompt(language),
          // THE cache breakpoint. Everything above it is byte-identical on
          // every request, so from the second note onward this prefix bills
          // at ~0.1x. Anything volatile must stay below it, in the user turn.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userTurn({
            text: rawText,
            capturedAt,
            timezone: user.timezone,
          }),
        },
      ],
    });

    const latencyMs = Date.now() - started;

    // Check stop_reason BEFORE touching content. On a refusal `content` is
    // empty or partial, and indexing into it throws.
    if (response.stop_reason === "refusal") {
      // Status and telemetry are handled by the single catch below, so there
      // is exactly one place that decides how a failed note is left. The
      // category is logged rather than encoded into the error code, which
      // clients switch on and which therefore has to stay stable.
      console.warn("enrichment_refused", {
        note_id: noteId,
        category: response.stop_details?.category ?? "unknown",
      });
      throw new HttpError(422, "enrichment_refused");
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new HttpError(502, "enrichment_empty");
    }

    const enrichment: Enrichment = JSON.parse(textBlock.text);
    const usage = response.usage ?? {};

    // Cache health check. A permanent zero here means something volatile
    // crept into the system prompt and every note is paying full price.
    if ((usage.cache_read_input_tokens ?? 0) === 0) {
      console.warn("prompt_cache_miss", { note_id: noteId, language });
    }

    await admin.from("note_enrichments").upsert(
      {
        note_id: noteId,
        user_id: user.id,
        language,
        title: enrichment.title,
        summary: enrichment.summary,
        category: enrichment.category,
        priority: enrichment.priority,
        suggested_action: enrichment.suggested_action,
        action_due_at: enrichment.action_due_at,
        context: enrichment.context,
        model: ENRICHMENT_MODEL,
        prompt_version: PROMPT_VERSION,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        cached_tokens: usage.cache_read_input_tokens ?? null,
      },
      { onConflict: "note_id,language,prompt_version" },
    );

    await admin.rpc("attach_tags", {
      p_user_id: user.id,
      p_note_id: noteId,
      p_language: language,
      p_labels: enrichment.tags ?? [],
    });

    await recordJob(
      admin,
      {
        userId: user.id,
        noteId,
        stage: "enrich",
        language,
        provider: "anthropic",
        model: ENRICHMENT_MODEL,
        latencyMs,
        inputTokens: usage.input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
        cachedTokens: usage.cache_read_input_tokens ?? null,
        costUsd: costUsd(usage),
      },
      "succeeded",
    );

    // ---------------------------------------------------------------------
    // Stage 4: embedding. Summary first, then raw text -- the summary is the
    // denoised signal, and putting it first keeps it inside the window if a
    // long note gets truncated.
    // ---------------------------------------------------------------------
    // Stages 4 and 5 are ENHANCEMENTS, not requirements, so they are isolated:
    // a failure here must not discard a note whose enrichment already
    // succeeded and is already persisted above.
    //
    // Found the hard way. A misconfigured embedding key made the whole request
    // throw, which reset the note to `queued` even though the expensive
    // Anthropic call had completed and been saved. The note could never reach
    // `ready`, so it stayed invisible in the timeline — while the enrichment
    // sat in the database, paid for and unused.
    //
    // Without embeddings a note is still entirely usable: it has a summary,
    // category, priority, tags, and full lexical search. It is only missing
    // from SEMANTIC search results. Degrading is strictly better than hiding it.
    //
    // A missing `note_embeddings` row is its own backfill marker, so a later
    // sweep can find and re-embed exactly these notes.
    try {
      const embedder = embeddingProvider();
      const embedStarted = Date.now();
      const content = `${enrichment.title}\n${enrichment.summary}\n\n${rawText}`;
      const [vector] = await embedder.embed([content], "document");

      await admin.from("note_embeddings").upsert(
        {
          note_id: noteId,
          user_id: user.id,
          language,
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
          userId: user.id,
          noteId,
          stage: "embed",
          language,
          provider: embedder.name,
          model: embedder.model,
          latencyMs: Date.now() - embedStarted,
        },
        "succeeded",
      );

      // Stage 5: relations. Pure vector k-NN, no model call. Inside the same
      // block because it is meaningless without the embedding above.
      await admin.rpc("relate_note", {
        p_user_id: user.id,
        p_note_id: noteId,
        p_language: language,
      });
    } catch (e) {
      console.warn("embedding_stage_degraded", {
        note_id: noteId,
        error: e instanceof HttpError ? e.code : String(e),
      });
      await recordJob(
        admin,
        {
          userId: user.id,
          noteId,
          stage: "embed",
          language,
          errorCode: e instanceof HttpError ? e.code : "unknown",
        },
        "failed",
      );
    }

    // Language detection is recorded even though nothing routes on it yet.
    // By the time English is enabled there is already a labelled corpus to
    // validate the routing against.
    const detected = detectLanguage(rawText) ??
      (enrichment.detected_language
        ? { language: enrichment.detected_language, confidence: enrichment.confidence }
        : null);

    await admin
      .from("notes")
      .update({
        status: "ready",
        detected_language: detected?.language ?? null,
        language_confidence: detected?.confidence ?? null,
      })
      .eq("id", noteId);

    return json(
      {
        note_id: noteId,
        enrichment,
        detected,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cost_usd: Number(costUsd(usage).toFixed(6)),
        },
        cached: false,
      },
      { language, direction: SUPPORTED[language]?.direction ?? "rtl" },
    );
    } // end runPipeline
  } catch (err) {
    return errorResponse(err, language);
  }
});
