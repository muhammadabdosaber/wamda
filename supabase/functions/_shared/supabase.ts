/** Supabase client construction + auth, and pipeline telemetry. */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, requireEnv } from "./http.ts";

/**
 * A client that acts AS THE CALLER: it forwards the user's JWT, so every query
 * runs under that user's RLS policies.
 *
 * Use this for anything reading or writing user data on behalf of a request.
 * If a bug lets a note id leak across users, RLS still refuses the read.
 */
export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new HttpError(401, "unauthenticated");

  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client that BYPASSES RLS. Only for pipeline writes the user must not be
 * able to forge -- enrichments, embeddings, telemetry.
 *
 * Every use must filter by user_id explicitly, because the database will no
 * longer do it for you. Treat each call site as security-relevant.
 */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthedUser {
  id: string;
  uiLocale: string;
  timezone: string;
}

/** Resolve the caller and their profile in one round trip. */
export async function authenticate(client: SupabaseClient): Promise<AuthedUser> {
  const { data: auth, error } = await client.auth.getUser();
  if (error || !auth?.user) throw new HttpError(401, "unauthenticated");

  const { data: profile } = await client
    .from("profiles")
    .select("ui_locale, timezone")
    .eq("id", auth.user.id)
    .maybeSingle();

  return {
    id: auth.user.id,
    uiLocale: profile?.ui_locale ?? "ar",
    timezone: profile?.timezone ?? "Asia/Dubai",
  };
}

export type JobStage = "transcribe" | "detect_language" | "enrich" | "embed" | "relate" | "digest";

export interface JobRecord {
  userId: string;
  noteId?: string | null;
  stage: JobStage;
  language?: string | null;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  costUsd?: number | null;
  errorCode?: string | null;
}

/**
 * Record pipeline telemetry. Shape and cost only -- NEVER note content.
 *
 * Telemetry tables get queried during incidents by whoever is on call, and
 * exported into dashboards. Note text is the most sensitive data this product
 * holds; it does not belong on that path.
 *
 * Failures here are swallowed on purpose: losing a metric must never fail the
 * user's note.
 */
export async function recordJob(
  client: SupabaseClient,
  job: JobRecord,
  status: "succeeded" | "failed",
): Promise<void> {
  try {
    await client.from("ai_jobs").insert({
      user_id: job.userId,
      note_id: job.noteId ?? null,
      stage: job.stage,
      status,
      language: job.language ?? null,
      provider: job.provider ?? null,
      model: job.model ?? null,
      latency_ms: job.latencyMs ?? null,
      input_tokens: job.inputTokens ?? null,
      output_tokens: job.outputTokens ?? null,
      cached_tokens: job.cachedTokens ?? null,
      cost_usd: job.costUsd ?? null,
      error_code: job.errorCode ?? null,
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("telemetry_write_failed", e instanceof Error ? e.message : String(e));
  }
}
