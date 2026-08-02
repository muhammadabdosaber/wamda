# 7. Performance

## Budgets

| Path | Target | How |
|---|---|---|
| Capture → visible | < 100 ms | local SQLite write; network never on this path |
| Transcription (30 s audio) | < 5 s | AAC ~64 kbps client-side; direct-to-Storage upload |
| Enrichment | < 8 s p95 | one combined call, `effort: medium` |
| Search | < 300 ms p95 | HNSW + GIN; 200 candidates per arm before fusion |
| Timeline page | < 200 ms | keyset pagination, partial index, no `raw_text` |
| Weekly digest | irrelevant | Batch API, off-peak, nobody waiting |

The first row is the one that decides whether the product works. Everything
else can be slow; capture cannot.

## Client

**Capture never awaits the network.** Write to SQLite, render, then sync
behind it. Perceived latency is disk latency.

**AAC in m4a, mono, 64 kbps** — roughly a tenth of WAV at speech quality.
Upload time dominates perceived transcription latency far more than the ASR
call does.

**Audio goes client → Storage directly** under a signed URL. Routing 25 MB
through an Edge Function would burn function memory and cap recording length
at the request size limit.

**Search input is debounced 350 ms.** Every hybrid search costs an embedding
call; firing per keystroke bills an API request per character typed.

**Sync is sequential, oldest-first.** Parallel replay after a long offline
stretch is exactly the burst shape that trips per-user rate limits.

## Database

**Keyset pagination, never `OFFSET`.** `OFFSET` re-scans and discards every
skipped row — page 50 costs 50× page 1 — and it silently skips or repeats rows
when notes sync in mid-scroll.

**The timeline query never selects `raw_text`.** It renders summaries. On a
long scroll that is a 30 KB response instead of 900 KB.

**Partial indexes** on `status = 'ready' AND archived_at IS NULL` (timeline)
and `action_due_at IS NOT NULL` (action inbox). Indexing failed and draft rows
would grow the index for queries that never read them.

**HNSW, `m=16`, `ef_construction=64`** — pgvector defaults, stated explicitly
so a future tuning change shows up as a visible diff rather than a silent one.

**Fusion happens in SQL.** Doing RRF in TypeScript would mean shipping two full
candidate sets over the wire just to merge and discard most of them.

**200 candidates per arm** before fusion: ~10× a page, deep enough for fusion
to have something to reorder, shallow enough to stay inside the latency budget.

## Model calls

**One enrichment call, not six.** Six would be six times the latency, six times
the cost, and six chances to disagree about the same note.

**Prompt caching** on the frozen system prefix: ~0.1× on cached tokens, roughly
60% off the per-note input cost. Depends entirely on byte stability — the
function logs `prompt_cache_miss` so a regression is visible rather than merely
expensive.

**`effort: "medium"`** for enrichment. Classification against a fixed taxonomy
does not need deep reasoning; `high` would raise cost and latency for output
that is already schema-constrained.

**Batch API for digests** — 50% off, and it collapses N concurrent Saturday
requests into one submission.

## Retry and cost safety

Every billable stage is idempotent: `/notes` on `client_id`, `/transcribe` on
existing `raw_text`, `/enrich` on `(note, language, prompt_version)`. A retry
costs a request, never a second charge.

`ai_jobs` records latency, tokens, and `cost_usd` per call, so the cost model in
`docs/04-ai-pipeline.md` is checkable rather than assumed.

## What is not optimized, and why

- **No embedding chunking.** `note_embeddings.chunk_index` exists for it, but a
  personal note is short. Chunking adds complexity for a corpus that does not
  need it yet.
- **No read replicas, no cache layer.** Single-user scale. Adding either now
  would be infrastructure with no measured problem behind it.
- **`ai_jobs` has no retention policy yet.** It grows unbounded. Fine at
  current volume, needs a partition or a sweep before it isn't.
