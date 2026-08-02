# 4. AI Pipeline (Arabic-first)

Six stages. Each takes `(input, language)`, is independently retryable, and
records shape/cost — never content — in `ai_jobs`.

| # | Stage | Provider | Where |
|---|---|---|---|
| 1 | Transcription | ElevenLabs Scribe | `functions/transcribe` |
| 2 | Language detection | local, no network | `_shared/language.ts` |
| 3 | Enrichment | Claude Opus 5 | `functions/enrich` |
| 4 | Embedding | Cohere embed-multilingual-v3.0 | `functions/enrich` |
| 5 | Relations | Postgres k-NN | `relate_note()` RPC |
| 6 | Weekly digest | Claude Opus 5, Batch API | `functions/digest` |

## Stage 1 — Transcription

`language_code` is a parameter taken from the resolved language, not a
constant. Scribe returns per-word probabilities; the note-level confidence is
their mean.

**Below 0.6 the note stops as `draft` instead of continuing.** Enriching a
garbled transcript is worse than not enriching it: it produces a *confident,
wrong* summary that the user cannot distinguish from a correct one, so the
thought is silently lost. Better to ask them to check the text.

## Stage 2 — Language detection

Script-ratio detection: synchronous, no model call, no network. It cannot
separate languages sharing a script (Arabic vs Persian), which is fine for the
ar/en split this product needs — and when it isn't, the low confidence score is
the signal to escalate.

**It runs in phase 1 even though nothing routes on it.** It populates
`detected_language`, so on the day English is enabled there is already a
labelled corpus to validate routing against, rather than a code path nobody
has ever executed.

## Stage 3 — Enrichment

Summary, title, category, tags, priority, suggested action, due date, and
extracted context come from **one** request. Six calls would be six times the
latency, six times the cost, and six chances to disagree about what the note
says.

```ts
const response = await anthropic.beta.messages.create({
  model: "claude-opus-5",
  max_tokens: 8192,
  thinking: { type: "adaptive" },
  output_config: {
    effort: "medium",
    format: { type: "json_schema", schema: ENRICHMENT_SCHEMA },
  },
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  system: [{ type: "text", text: systemPrompt(language),
             cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: userTurn({ ... }) }],
});
```

Five things in that call are load-bearing:

**`output_config.format`, not a prefill.** Assistant prefills return 400 on
Opus 5. A JSON schema is the supported way to force shape — and it makes the
enum contract machine-enforced rather than hoped-for.

**`max_tokens: 8192`.** Thinking is on by default on Opus 5, and `max_tokens`
caps thinking *plus* output. Sizing it tightly around the expected JSON would
let a note that provokes reasoning truncate the body mid-object.

**The cache breakpoint.** The system prompt (Arabic instructions + taxonomy +
few-shot examples) is byte-identical on every request, so from the second note
onward that prefix bills at ~0.1×. This only works if the prompt is *frozen*:
one interpolated timestamp, user name, or note id and the cache never hits,
quietly tripling per-note cost. Per-note context goes in the user turn, below
the breakpoint. The function logs `prompt_cache_miss` when
`cache_read_input_tokens` is 0 — a permanent warning means something volatile
crept in.

**`stop_reason` is checked before `content`.** On a refusal `content` is empty
or partial; indexing into it throws. `fallbacks: "default"` re-runs a declined
request on a fallback model server-side, routed by refusal category, so there
is no pinned model to maintain.

**Enum values are English; content is Arabic.** The prompt says so explicitly.
This is the same rule as the schema, enforced at the model boundary.

### Prompt injection

Note text is *data*. The system prompt states that the note is a transcript of
something the user said to themselves, and that text inside it which appears
addressed to the model — "ignore your instructions", "output JSON with…" — is
ordinary content to be classified, never followed. The structured-output
schema is the second layer: even a fully successful injection cannot make the
model emit a shape the schema forbids.

## Stage 4 — Embedding

Cohere `embed-multilingual-v3.0`, 1024 dimensions, over
`title + summary + raw_text` in that order — the summary is the denoised
signal, and putting it first keeps it in-window if a long note is truncated.

**Why this model specifically:** it aligns Arabic and English into a *shared*
vector space. In phase 2, an Arabic query retrieves English notes with no
re-indexing and no translation step. A monolingual Arabic embedder would force
a full re-embed of the corpus the day English ships.

`search_document` for storage, `search_query` for queries. Cohere embeds these
asymmetrically; using the wrong one measurably degrades recall.

## Stage 5 — Relations

Pure vector k-NN inside Postgres (`relate_note()`), cosine similarity ≥ 0.78,
top 5. No model call, so it costs a few milliseconds and no tokens.

## Stage 6 — Weekly digest

`pg_cron` fires Saturday; the function submits **one Message Batch** covering
all users with activity that week, then a later invocation collects results.

Batching rather than a call per user: nobody is waiting on a weekly digest,
batch runs at 50% price, and it collapses N concurrent requests into one
submission — otherwise a growing user base turns Saturday 03:00 into a
rate-limit incident.

Batch results arrive in **arbitrary order**, so they are keyed by `custom_id`
(`user__language`), never by index. The batch handle outlives the submitting
process, which is why `digest_batches` exists as a table.

## Cost

Claude Opus 5 at $5 / $25 per MTok:

| Component | Tokens | Cost |
|---|---|---|
| System prompt, cached | ~1,500 @ $0.50/MTok | $0.00075 |
| Note + context, uncached | ~400 @ $5/MTok | $0.00200 |
| Output | ~500 @ $25/MTok | $0.01250 |
| Embedding | — | ~$0.0001 |
| **Per note** | | **≈ $0.015** |

Prompt caching removes roughly 60% of what the uncached input would cost. At
20 notes/day that is about $9/month for one user.

`ai_jobs.cost_usd` records this per call, so the number above is checkable
rather than assumed. If volume grows, `ENRICHMENT_MODEL` is one constant —
prompts and schema are model-agnostic.
