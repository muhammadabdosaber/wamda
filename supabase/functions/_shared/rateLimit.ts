/**
 * Per-user rate limit on vendor-calling stages (SB-002).
 *
 * `/enrich` and `/transcribe` call paid APIs with no bound today, so a
 * runaway client loop is a runaway vendor bill. The gate lives here, not in
 * an in-memory counter: Edge Function instances are not guaranteed to survive
 * between invocations, so anything not in Postgres resets on every cold
 * start and is trivially bypassed. `ai_jobs` already logs every attempt --
 * `rate_limit_hit()` (migration 20260806000100) is the single count query
 * both endpoints share.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { recordJob, type JobStage } from "./supabase.ts";

/**
 * Calls per stage, per user, per window. Sized so the client's own sequential
 * outbox replay -- up to ~50 queued notes after a long offline stretch,
 * `web/src/data/api.ts` `sync()` -- comfortably clears it, while a genuine
 * runaway loop (hundreds of calls) still trips it well before the vendor
 * bill does.
 */
const LIMIT = 60;
const WINDOW_MINUTES = 15;

/**
 * Throws `HttpError(429, "rate_limited")` if the caller has made LIMIT-or-
 * more `stage` calls in the trailing window. Call this AFTER note ownership
 * is verified and BEFORE the vendor is reached: everything before this point
 * is free, everything after it costs money, and the whole point is that a
 * rejected call never crosses that line.
 */
export async function enforceRateLimit(
  admin: SupabaseClient,
  userId: string,
  stage: JobStage,
  noteId?: string,
): Promise<void> {
  const { data: hit, error } = await admin.rpc("rate_limit_hit", {
    p_user_id: userId,
    p_stage: stage,
    p_limit: LIMIT,
    p_window_minutes: WINDOW_MINUTES,
  });

  if (error) {
    // Fail OPEN: a broken telemetry read must not itself block a legitimate
    // call. If Postgres is actually unreachable, the pipeline call this
    // gates fails on its own moments later -- the same reasoning recordJob
    // already uses for its own failures.
    console.error("rate_limit_check_failed", error.message);
    return;
  }

  if (hit) {
    await recordJob(admin, { userId, noteId, stage, errorCode: "rate_limited" }, "failed");
    throw new HttpError(429, "rate_limited");
  }
}
