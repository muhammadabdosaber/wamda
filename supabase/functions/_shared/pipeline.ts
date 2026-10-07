/**
 * Enrichment and transcription, decoupled from the HTTP request that
 * triggers them.
 *
 * `enrich` and `transcribe` call these to serve a live user request; `sweep`
 * calls the same functions to retry a note nobody is waiting on. There is
 * exactly one place that knows how to run a note through either stage, so a
 * prompt change, a status-transition fix, or a telemetry field only needs to
 * be right once.
 *
 * Every function here takes an explicit `userId` and a service-role client:
 * there is no request, no JWT, no caller RLS to lean on. Callers are
 * responsible for having already verified the note belongs to that user.
 */

// Pinned. Unpinned, this resolved to whatever was newest at build time, which
// meant the local machine and CI type-checked against different SDK versions
// -- and they disagreed: CI pulled 0.115.0 and rejected code that passed
// locally. A vendor type is part of this build's correctness (see
// docs/00-verification.md on what `deno check` is actually for), so it gets a
// version like any other dependency. Bump deliberately, with a check.
import Anthropic from "npm:@anthropic-ai/sdk@0.115.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError, requireEnv } from "./http.ts";
import { recordJob } from "./supabase.ts";
import { detectLanguage } from "./language.ts";
import { asrProvider, embeddingProvider } from "./providers.ts";
import {
  ENRICHMENT_MODEL,
  ENRICHMENT_SCHEMA,
  type Enrichment,
  PROMPT_VERSION,
  systemPrompt,
  userTurn,
} from "./enrichment.ts";

// ---------------------------------------------------------------------------
// Stage 3-5: enrichment, embedding, relations
// ---------------------------------------------------------------------------

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

export interface EnrichInput {
  admin: SupabaseClient;
  userId: string;
  noteId: string;
  language: string;
  rawText: string;
  capturedAt: string;
  timezone: string;
  /** Skip the idempotency check and re-run even if this prompt_version already ran. */
  force?: boolean;
}

export interface EnrichOutput {
  enrichment: Enrichment;
  detected: { language: string; confidence: number } | null;
  usage?: {
    // Nullable, not merely optional -- the SDK reports these as `number | null`
    // and this shape is filled straight from it. `costUsd` above already says
    // so, and the `ai_jobs` writes already coalesce with `?? null`; this
    // declaration was the one place still claiming otherwise.
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cost_usd: number;
  };
  cached: boolean;
}

/**
 * Runs stages 3-5 for one note: enrichment, embedding, and relation
 * detection. Moves the note through `enriching` and out again on every path
 * -- the timeline filters on `status = 'ready'`, so a note left in
 * `enriching` becomes invisible with no error and no way back.
 */
export async function runEnrichment(input: EnrichInput): Promise<EnrichOutput> {
  const { admin, userId, noteId, language, rawText, capturedAt, timezone } = input;

  // Idempotency. Enrichment is the expensive stage; a retried request, a
  // double-tap, or a sweep re-picking up a note must not pay for it twice.
  // Keyed on prompt_version so a prompt change legitimately re-runs.
  if (!input.force) {
    const { data: existing } = await admin
      .from("note_enrichments")
      .select("*")
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .eq("language", language)
      .eq("prompt_version", PROMPT_VERSION)
      .maybeSingle();

    if (existing) {
      return { enrichment: existing as unknown as Enrichment, detected: null, cached: true };
    }
  }

  await admin.from("notes").update({ status: "enriching" }).eq("id", noteId);

  try {
    return await run();
  } catch (err) {
    // A refusal is terminal: re-running the same note against the same
    // prompt will refuse again. Anything else is transient, so the note
    // returns to `queued` where the sweep worker can retry it.
    const terminal = err instanceof HttpError && err.code === "enrichment_refused";
    await admin
      .from("notes")
      .update({ status: terminal ? "failed" : "queued" })
      .eq("id", noteId);

    await recordJob(
      admin,
      {
        userId,
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

  async function run(): Promise<EnrichOutput> {
    const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
    const started = Date.now();

    const response = await anthropic.beta.messages.create({
      model: ENRICHMENT_MODEL,
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ENRICHMENT_SCHEMA },
      },
      system: [
        {
          type: "text",
          text: systemPrompt(language),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userTurn({ text: rawText, capturedAt, timezone }),
        },
      ],
    });

    const latencyMs = Date.now() - started;

    if (response.stop_reason === "refusal") {
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

    if ((usage.cache_read_input_tokens ?? 0) === 0) {
      console.warn("prompt_cache_miss", { note_id: noteId, language });
    }

    const { error: saveError } = await admin.from("note_enrichments").upsert(
      {
        note_id: noteId,
        user_id: userId,
        language,
        title: enrichment.title,
        summary: enrichment.summary,
        key_points: enrichment.key_points ?? [],
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
    // Without this check a rejected write (a column the database does not
    // have yet, a constraint) fell through to `status: 'ready'` below: a note
    // marked done with no enrichment, which the user sees as stuck forever.
    // Throwing returns it to `queued`, where the sweep retries it.
    if (saveError) {
      console.error("enrichment_save_failed", { note_id: noteId, error: saveError.message });
      throw new HttpError(500, "enrichment_save_failed");
    }

    await admin.rpc("attach_tags", {
      p_user_id: userId,
      p_note_id: noteId,
      p_language: language,
      p_labels: enrichment.tags ?? [],
    });

    await recordJob(
      admin,
      {
        userId,
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

    // Stages 4-5 are ENHANCEMENTS, not requirements, so they are isolated: a
    // failure here must not discard a note whose enrichment already
    // succeeded and is already persisted above. Without embeddings a note is
    // still entirely usable -- summary, category, priority, tags, and full
    // lexical search all work. It is only missing from semantic search
    // results, and a missing `note_embeddings` row is its own backfill
    // marker for the sweep worker.
    try {
      const embedder = embeddingProvider();
      const embedStarted = Date.now();
      const content = `${enrichment.title}\n${enrichment.summary}\n\n${rawText}`;
      const [vector] = await embedder.embed([content], "document");

      await admin.from("note_embeddings").upsert(
        {
          note_id: noteId,
          user_id: userId,
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
          userId,
          noteId,
          stage: "embed",
          language,
          provider: embedder.name,
          model: embedder.model,
          latencyMs: Date.now() - embedStarted,
        },
        "succeeded",
      );

      await admin.rpc("relate_note", {
        p_user_id: userId,
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
          userId,
          noteId,
          stage: "embed",
          language,
          errorCode: e instanceof HttpError ? e.code : "unknown",
        },
        "failed",
      );
    }

    // Language detection is recorded even though nothing routes on it yet.
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

    return {
      enrichment,
      detected,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cost_usd: Number(costUsd(usage).toFixed(6)),
      },
      cached: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Stage 1: transcription
// ---------------------------------------------------------------------------

/**
 * Below this, the transcript is flagged for review instead of being fed
 * downstream. Enriching a garbled transcript is worse than not enriching it:
 * it produces a confident, wrong summary, and the user has no way to tell it
 * apart from a correct one -- so the note is quietly lost.
 */
const REVIEW_THRESHOLD = 0.6;

export interface TranscribeInput {
  admin: SupabaseClient;
  userId: string;
  noteId: string;
  audioPath: string;
  language: string;
}

export interface TranscribeOutput {
  text: string;
  confidence: number;
  needsReview: boolean;
  detected: { language: string; confidence: number } | null;
  cached: boolean;
}

/** Runs stage 1: audio -> text. */
export async function runTranscription(input: TranscribeInput): Promise<TranscribeOutput> {
  const { admin, userId, noteId, audioPath, language } = input;

  // Already transcribed: transcription is billable and slow, so a retry (a
  // sweep re-pick-up included) must not re-run it.
  const { data: current } = await admin
    .from("notes")
    .select("raw_text")
    .eq("id", noteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (current?.raw_text?.trim()) {
    return { text: current.raw_text, confidence: 1, needsReview: false, detected: null, cached: true };
  }

  await admin.from("notes").update({ status: "transcribing" }).eq("id", noteId);

  const { data: audio, error: dlErr } = await admin.storage.from("audio").download(audioPath);

  if (dlErr || !audio) {
    // Same trap as below: the note is already marked `transcribing`, and
    // leaving it there makes it invisible to the timeline with nothing to
    // retry it. Back to `draft` -- the audio may simply not have finished
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
        userId,
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
      userId,
      noteId,
      stage: "transcribe",
      language,
      provider: result.provider,
      model: result.model,
      latencyMs,
    },
    "succeeded",
  );

  return {
    text: result.text,
    confidence: result.confidence,
    needsReview,
    detected,
    cached: false,
  };
}
