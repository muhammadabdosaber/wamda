/**
 * Weekly digest generation, via the Message Batches API.
 *
 *   POST /functions/v1/digest { action: "enqueue" }  -- submit the week
 *   POST /functions/v1/digest { action: "collect" }  -- write finished results
 *
 * Both are service-triggered (pg_cron), not user-facing.
 *
 * Batching rather than one call per user: nobody is waiting on a weekly
 * digest, and batch runs at 50% of standard price. It also collapses N
 * concurrent requests into one submission, so a growing user base does not
 * turn Saturday 03:00 into a rate-limit incident.
 */

import Anthropic from "npm:@anthropic-ai/sdk";

import { errorResponse, HttpError, json, preflight, requireEnv } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { SUPPORTED } from "../_shared/language.ts";

const DIGEST_MODEL = "claude-opus-5";

/**
 * Cache-stable per language, exactly like the enrichment prompt. Every user's
 * request in a batch shares this prefix, so the cache is written once for the
 * whole batch and read for the rest.
 */
const DIGEST_PROMPTS: Record<string, string> = Object.freeze({
  ar: `You write a weekly review for a personal "second brain" app.

The reader has ADHD. The point of this review is to make the week legible
without making them feel behind. It is a calm re-orientation, not a backlog.

Write ALL prose in Modern Standard Arabic (العربية الفصحى).

Return JSON with exactly these keys:
  "headline"        one sentence, what this week was actually about
  "themes"          2-4 recurring threads, each { "title", "detail" }
  "open_loops"      unfinished items that still matter, most consequential first
  "wins"            what got done -- never leave this empty if anything did
  "suggestion"      ONE concrete next step, not a list

Rules:
- Never scold, never imply the user fell behind, never count what they missed.
- Omit a section rather than padding it with filler.
- Cite notes by their summary text, not by id.`,
});

function digestPrompt(language: string): string {
  return DIGEST_PROMPTS[language] ?? DIGEST_PROMPTS.ar;
}

/** ISO week window ending at the given date (exclusive end). */
function weekWindow(reference = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const body = await req.json().catch(() => ({}));
    const admin = serviceClient();
    const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

    // -----------------------------------------------------------------------
    // enqueue
    // -----------------------------------------------------------------------
    if (body.action === "enqueue") {
      const { start, end } = weekWindow();

      // One row per user with material this week, carrying that user's
      // enrichments. Service role bypasses RLS, so the per-user scoping here
      // is ours to get right.
      const { data: rows, error } = await admin
        .from("note_enrichments")
        .select("user_id, language, title, summary, category, priority, notes!inner(client_created_at)")
        .gte("notes.client_created_at", start)
        .lt("notes.client_created_at", end);

      if (error) throw new HttpError(500, "digest_query_failed");

      const byUser = new Map<string, { language: string; lines: string[] }>();
      for (const r of rows ?? []) {
        const key = `${r.user_id}:${r.language}`;
        if (!byUser.has(key)) byUser.set(key, { language: r.language, lines: [] });
        byUser.get(key)!.lines.push(
          `- [${r.category}/${r.priority}] ${r.title}: ${r.summary}`,
        );
      }

      if (byUser.size === 0) {
        return json({ enqueued: 0, reason: "no_activity" });
      }

      const requests = [...byUser.entries()].map(([key, v]) => ({
        // custom_id carries everything needed to route the result back.
        // Batch results arrive in ARBITRARY order -- never key them by index.
        custom_id: key.replace(/:/g, "__"),
        params: {
          model: DIGEST_MODEL,
          max_tokens: 4096,
          system: [{
            type: "text" as const,
            text: digestPrompt(v.language),
            cache_control: { type: "ephemeral" as const },
          }],
          messages: [{
            role: "user" as const,
            content: `Week ${start} to ${end}.\n\nNotes:\n${v.lines.join("\n")}`,
          }],
        },
      }));

      const batch = await anthropic.messages.batches.create({ requests });

      await admin.from("digest_batches").insert({
        provider_batch_id: batch.id,
        language: "multi",
        period_start: start,
        period_end: end,
        request_count: requests.length,
      });

      return json({ enqueued: requests.length, batch_id: batch.id, period: { start, end } });
    }

    // -----------------------------------------------------------------------
    // collect
    // -----------------------------------------------------------------------
    if (body.action === "collect") {
      const { data: open } = await admin
        .from("digest_batches")
        .select("*")
        .eq("status", "submitted");

      let written = 0;

      for (const batchRow of open ?? []) {
        const batch = await anthropic.messages.batches.retrieve(batchRow.provider_batch_id);
        if (batch.processing_status !== "ended") continue;

        for await (
          const result of await anthropic.messages.batches.results(batchRow.provider_batch_id)
        ) {
          if (result.result.type !== "succeeded") {
            console.error("digest_result_failed", result.custom_id, result.result.type);
            continue;
          }

          const [userId, language] = result.custom_id.split("__");
          const text = result.result.message.content.find((b) => b.type === "text");
          if (!text || text.type !== "text") continue;

          // Observed for real (2026-08-07): the model wraps its JSON in a
          // ```json fence even though the prompt asks for JSON alone and
          // nothing about the request constrains the schema (Batches has no
          // structured-outputs equivalent). Strip a fence if present before
          // parsing, so the common case doesn't fall through to the raw-text
          // fallback below.
          const fenced = text.text.match(/```(?:json)?\s*([\s\S]*?)```/);
          const jsonText = fenced ? fenced[1] : text.text;

          let content: unknown;
          try {
            content = JSON.parse(jsonText);
          } catch {
            // Still not parseable JSON. Keep the prose rather than dropping
            // a whole week of review on a parse failure.
            content = { headline: text.text };
          }

          await admin.from("weekly_digests").upsert({
            user_id: userId,
            language,
            period_start: batchRow.period_start,
            period_end: batchRow.period_end,
            content,
            model: DIGEST_MODEL,
          }, { onConflict: "user_id,period_start,language" });

          written += 1;
        }

        await admin
          .from("digest_batches")
          .update({
            status: "collected",
            collected_count: written,
            collected_at: new Date().toISOString(),
          })
          .eq("id", batchRow.id);
      }

      return json({ collected: written });
    }

    throw new HttpError(400, "unknown_action");
  } catch (err) {
    return errorResponse(err);
  }
});
