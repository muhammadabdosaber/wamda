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

**Observed for real (2026-08-07), the risk this stage's own code comment
flagged:** Batches has no structured-outputs equivalent, and the model wraps
its JSON in a ` ```json ` fence even though the prompt asks for JSON alone —
the first real run parsed as a failure and fell all the way to the
raw-text fallback (`{"headline": "```json\n{...}\n```"}`). Fixed by stripping
a fence before `JSON.parse`, re-run for real, second batch parsed cleanly
into the full `{headline, themes, open_loops, wins, suggestion}` shape. Model
output itself, once parsed, matched the prompt's intent well on real data:
calm tone, no scolding, one concrete suggestion, correctly identified a
repeated note ("حلاقة الشعر مع مالك") as a pattern worth surfacing rather than
four unrelated items.

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

## Model choice: Opus 5 vs Haiku 4.5 (SB-034)

**Decision: stay on Opus 5. Measured, 2026-08-07, not estimated.**

An abandoned branch (`archive/sweep-worker-haiku-variant`, 2026-08-02) had
already swapped `ENRICHMENT_MODEL` to `claude-haiku-4-5` for the ~5x cost
estimate, but never merged and never had output quality checked against it.
This ran the exact production prompt and schema through both models, in
parallel, against the owner's real 12 real text notes (excluding 2 voice
notes with no transcript yet) — not synthetic data. Haiku's request shape
matches the abandoned branch: no `thinking`, no `output_config.effort`, no
refusal-fallback beta (Haiku 4.5 rejects all three with `400`); structured
output via `output_config.format` works on both.

| Field | Agreement | 
|---|---|
| `category` | 7/12 = 58.3% |
| `priority` | 10/12 = 83.3% |
| `suggested_action` | 3/12 = 25.0% |
| relative-date **day** resolved correctly (6 notes said "بكرة") | 12/12 = 100% (both models, no day-level bugs) |

**The specific risk named in this task's own brief — a wrong category — is
real, not hypothetical.** Three of the twelve notes are near-duplicate
captures of the same real event (retries of "عايز احلق شعري انا و مالك
بكره" / haircut with مالك tomorrow, worded slightly differently each time).
Opus called all three `task`, consistently. Haiku called them `task`,
`event`, `event` — **disagreeing with itself** across near-identical input,
not just with Opus. `suggested_action` showed the same pattern more broadly
(25% agreement) — Haiku defaulted to `none` or `review_later` on several
notes Opus classified as actionable.

**Date-*day* resolution held on both models** — every "بكرة" note landed on
the correct calendar day regardless of model. What differed was *time*:
Opus picked contextually plausible times (a stated "12 الظهر" was read
correctly by both; where no time was stated, Opus inferred one — 9am, noon,
evening — while Haiku defaulted to `00:00:00` in most of those cases, a
placeholder rather than a real estimate). Not a correctness bug, but a
quality gap on the one field this task flagged as most likely to break.

**Cost, measured, not the ~5x estimate:**

| | Opus 5 | Haiku 4.5 |
|---|---|---|
| Avg cost/note (this run) | $0.01179 | $0.00277 |
| Avg latency | 7026 ms | 3922 ms |
| Prompt cache engaged? | Yes — from the 2nd call on (2169-token system prompt clears Opus 5's 512-token cache minimum) | **No — 0 of 12 calls**, any call |

**Secondary finding: Haiku 4.5 cannot cache this prompt at its current
length.** Verified against Anthropic's current docs
(`platform.claude.com/docs/en/build-with-claude/prompt-caching`): the
minimum cacheable prompt length is **512 tokens for Opus 5** but **4,096
tokens for Haiku 4.5** — nearly 8x higher. The enrichment system prompt is
~2,169 tokens: comfortably above Opus 5's minimum, comfortably below
Haiku's. Every Haiku call in this run paid full input price
(`cache_creation_input_tokens` and `cache_read_input_tokens` both `0` on
all 12 calls); Opus 5 paid full price once and read from cache on the
other 11. Measured **4.26x** cheaper for Haiku here — real, but short of
the ~5x estimate, and the gap narrows further for a user who captures in
bursts (a realistic ADHD capture pattern), since only Opus benefits from
that.

**Not switching.** Per this task's own standing instruction — "do not
switch on price alone; a wrong category is the failure mode that makes the
user file things himself, which is the product failing" — a 75%
disagreement rate on `suggested_action` and self-inconsistent categorization
of the same real event is exactly that failure mode, not a marginal
quality difference. `ENRICHMENT_MODEL` stays `claude-opus-5`. Revisit only
if the prompt is deliberately re-tuned for Haiku (the current examples and
phrasing were shaped against Opus's behavior, not Haiku's) — swapping the
constant alone is not enough, and this run is evidence of that, not just an
assertion.

### Adding Sonnet 5 to the comparison (2026-08-09)

**Measured, not estimated.** Re-ran the SB-034 methodology fresh — same real
production prompt/schema copied verbatim into a standalone script, same
owner's 12 real text notes, all three models (Opus 5, Sonnet 5, Haiku 4.5)
called in the same run so the numbers are directly comparable, rather than
mixing this run's Sonnet data against SB-034's original Opus/Haiku numbers
from two days earlier. Sonnet request shape matches Opus's (`thinking:
adaptive`, `output_config.effort: "medium"`) — Sonnet 5 accepts both; only
Haiku drops them, same reasoning as SB-034.

| Field | Sonnet 5 vs Opus 5 | Haiku 4.5 vs Opus 5 |
|---|---|---|
| `category` | 10/12 = 83.3% | 9/12 = 75.0% |
| `priority` | 10/12 = 83.3% | 7/12 = 58.3% |
| `suggested_action` | 9/12 = 75.0% | 4/12 = 33.3% |

**The haircut-retry test that broke Haiku in SB-034 does not break Sonnet.**
Same three near-duplicate captures (`08041e8e`, `cd4e6e6d`, `a6887370`):
Opus 5 → task, task, task. Sonnet 5 → task, task, task — self-consistent,
matching Opus exactly. Haiku 4.5 → task, task, **event** — still
self-inconsistent on this exact case, reproducing SB-034's finding two days
later on a fresh run. Sonnet's 2 category disagreements with Opus were on
genuinely ambiguous notes (a placeholder note reading literally "ملاحظة"
["note"]; a plan to play a game after finishing chores, which Opus read as
`personal`/`event` and Sonnet read as `task` both times) — a difference in
judgment on ambiguous input, not the same-input-different-answer failure
mode this task was scoped to catch.

**Cost — a real, structural advantage, not a caching artifact.** Sonnet 5's
per-token price is a flat 0.6x of Opus 5's ($3/$15 vs $5/$25 per MTok), and
unlike Haiku, Sonnet's prompt-cache minimum (1,024 tokens) clears this
~2,169-token system prompt, so it caches exactly like Opus does (11/12 calls
hit cache, same as Opus). That means the ~0.6x saving holds regardless of
cache hit or miss — it is not contingent on a bursty capture pattern the
way Haiku's now-invalidated ~4.26x estimate was.

| | Opus 5 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|
| Avg cost/note (this run) | $0.00985 | $0.00665 | $0.00286 |
| Avg latency | 6061 ms | 5782 ms | 4263 ms |
| Cache hits | 11/12 | 11/12 | 0/12 |

**One incidental finding, not this task's subject:** re-running Opus 5 fresh
on `cd4e6e6d` returned `task`, matching SB-034's original write-up — but the
*production* `note_enrichments` row for that same note (from whenever it was
actually captured through the app) reads `category = event`. Same model,
same prompt, same input text, two different classifications across two real
calls. Opus 5 is highly consistent, not perfectly deterministic — worth
knowing when reading any single stored enrichment as ground truth, but not
a reason to revisit the SB-034 decision on its own.

**Not a decision — a data point for the owner.** Sonnet 5 lands meaningfully
closer to Opus than Haiku does on every quality axis measured here, and
survives the specific self-consistency test that Haiku failed, at ~1.5x
cheaper than Opus. Whether that's worth the remaining ~17–25% disagreement
rate on ambiguous notes is a product call, not an engineering one — this
section exists to make that call an informed one, not to make it.
`ENRICHMENT_MODEL` is unchanged (`claude-opus-5`) pending that decision.

Raw comparison data (12 notes × 2 models, full enrichment output, token
usage, and cost per call) is not committed — it's a one-off local
comparison run, not something the schema or app depends on — but the
methodology above is reproducible against the same 12 notes at any time.
