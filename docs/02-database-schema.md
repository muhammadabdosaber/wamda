# 2. Database Schema

Migrations: `supabase/migrations/`. Verified by `supabase/tests/verify.sql`
(26 checks, all passing — re-run 2026-08-20 against a clean `db reset`).

## The rule everything follows from

> **Never store a display label as a key.**

Categories, priorities, and actions are Postgres enums with stable English
identifiers. Their Arabic labels exist only in `web/src/i18n/ar.ts`, and
the mapping lives in `web/src/i18n/index.ts`.

Storing `'مهمة'` in the `category` column would mean:

- a data migration the day English ships,
- a backfill every time a label is reworded,
- a note that changes meaning when the user switches UI language.

Storing `'task'` costs nothing and survives all three.

UTF-8 is not the multilingual work — Postgres is UTF-8 by default. The
multilingual work is *structural*, and it is concentrated in two tables.

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | user settings | `ui_locale` defaults to `'ar'` |
| `notes` | canonical note | `client_id` unique per user (offline replay) |
| `note_enrichments` | **one row per (note, language)** | AI output |
| `tags` | language-neutral identity | `slug` only |
| `tag_labels` | display text per language | `(tag_id, language)` |
| `note_tags` | join | carries confidence |
| `note_embeddings` | **one row per (note, language, model)** | `vector(1024)` |
| `note_relations` | detected links | score, kind |
| `weekly_digests` | AI weekly review | `(user, period_start, language)` |
| `ai_jobs` | pipeline telemetry | shape and cost, never content |
| `digest_batches` | Batch API handles | operational, not user-facing |

### Why `note_enrichments` is keyed by language

This one table is the entire multilingual story. An English summary of an
Arabic note in phase 2 is **a second row**. Not a schema change, not a
migration, not a nullable `summary_en` column that half the code forgets to
check.

`note_embeddings` carries the same idea plus `model`, so an embedding-model
upgrade can be rolled out incrementally — dual-write, verify, cut over —
instead of a big-bang reindex that takes search offline.

### Two timestamps on `notes`, deliberately

- `client_created_at` — wall clock when the user captured the thought
- `created_at` — when the server received it

For an offline note these differ by hours. The timeline orders by
`client_created_at`; ordering by `created_at` would pile a whole day's notes
at the moment the phone reconnected, which is exactly when the user is trying
to find the thing they wrote this morning.

## Arabic text normalization

The hard part of Arabic search is that the same word has many legitimate
spellings:

| Variation | Example | Folded to |
|---|---|---|
| alef forms | أ إ آ ٱ | ا |
| taa marbuta | ة | ه |
| alef maqsura | ى | ي |
| hamza carriers | ؤ ئ | و / ي |
| tatweel | ـ (cosmetic elongation) | removed |
| harakat | َ ُ ِ ّ ْ | removed |

Two users — or the same user on two keyboards — produce different byte
sequences for one word. `normalize_ar()` folds all of it, and is applied on
**both** sides: in the stored `search_vector` and in the query. Verified:
a note stored ending in ة is found by a query ending in ه.

### Why the migration contains no inline Arabic

Every Arabic code point in `20260801000100_extensions_and_text.sql` is built
with `chr()`. This is not fussiness.

An Arabic range inside a regex character class — `[X-Y]` — gets visually
reordered by editors, diff viewers, and terminals applying the Unicode
bidirectional algorithm. The reordered text still *parses*, so a corrupted
range fails silently at runtime rather than erroring at deploy time. I hit
exactly this while writing the file: escape sequences were converted to
literals in transit. ASCII source removes the failure mode entirely.

## Language dispatch

Two functions are the only places in the database that know a language name:

```sql
normalize_for(text, lang)  -- ar → normalize_ar, else normalize_latin
ts_config_for(lang)        -- ar → arabic, en → english, else simple
```

`notes.search_vector` is a stored generated column over both:

```sql
to_tsvector(ts_config_for(input_language), normalize_for(raw_text, input_language))
```

An English note in phase 2 automatically gets the English stemmer. No trigger,
no application code, no backfill.

> **Caveat worth knowing:** Postgres does not recompute stored generated
> columns when a referenced function is redefined. If `normalize_ar()` ever
> changes, existing rows need `update notes set raw_text = raw_text;`.

## Indexes

| Index | Why |
|---|---|
| `notes_search_idx` GIN | lexical arm of search |
| `notes_timeline_idx` partial | the timeline query; partial on `ready`+unarchived |
| `note_embeddings_hnsw_idx` | semantic arm, cosine |
| `note_enrichments_facets_idx` | "urgent tasks in Arabic" |
| `note_enrichments_due_idx` partial | action inbox; only rows with a due date |
| `tags_slug_trgm_idx` | fuzzy tag picker |

Partial indexes matter here because the timeline only ever shows ready,
unarchived notes — indexing failed and draft rows would grow the index for
queries that never touch them.

## Retention

`ai_jobs` is pipeline telemetry — shape, cost, latency, error code, never note
content (`docs/08-security.md`) — so unlike everything else in this schema it
has no reason to be kept forever. **Rows older than 90 days are deleted daily**
by `public.purge_old_ai_jobs()`, scheduled via `pg_cron` at 03:00 UTC
(migration `20260807000100_ai_jobs_retention.sql`, SB-004).

**Audio is retained per user**, `profiles.audio_retention_days` (default 30).
`public.notes_audio_expired()` (migration `20260807000200_audio_retention.sql`,
SB-009) finds notes whose audio has outlived their own owner's setting; the
`sweep` Edge Function consumes it on the same schedule as everything else it
sweeps, deletes the Storage object via the Storage API (a raw SQL delete on
`storage.objects` would only remove the metadata and orphan the bytes), and
clears `notes.audio_path`. The note survives with its transcript — `raw_text`
is the durable artifact.

No other table has a retention policy: notes and their enrichments are the
product's memory and are kept until the user deletes them (SB-015).

## Operational views

`public.failed_ai_jobs` (migration `20260808000100_failed_ai_jobs_view.sql`,
SB-019) — one row per note+stage whose **latest** attempt in `ai_jobs` is
`failed`; a stage that failed once and later succeeded on retry does not
appear. Filter by `note_id` or `stage` directly. Not granted to
`authenticated` — the reader is the owner via Supabase Studio (connects as
the Postgres superuser, bypasses RLS); granting it to the client role would
first need `security_invoker` on the view, or `ai_jobs`'s own per-user RLS
would be silently bypassed.

**Success metrics** (migration `20260808000200_success_metrics.sql`, SB-020),
same not-granted-to-`authenticated` reasoning as above:

- `public.capture_latency_stats` — one row: count/avg/p50/p95/max of
  `notes.capture_latency_ms`, the client's own measured IndexedDB-write
  duration (`web/src/data/outbox.ts` `capture()`), against the product
  spec's p95 < 3 s target.
- `public.stuck_notes` — notes outside a terminal state (`draft`, `queued`,
  `transcribing`, `enriching`) for over an hour, excluding archived notes.
  A different, more generous threshold than `sweep`'s own 10-minute
  `STUCK_MINUTES` — that one exists to recover a killed worker fast, this one
  is the product metric for "is the pipeline keeping up".
- `public.note_cost` / `public.cost_summary` — per-note and aggregate spend
  from `ai_jobs.cost_usd`, split into `enrich_cost_usd` (the product spec's
  named metric) and `total_cost_usd` (every stage).

## Verification

`supabase/tests/verify.sql` asserts, against a live database:

1. alef-hamza, tatweel, and harakat all fold
2. taa-marbuta folds to haa
3. tag slugs converge across spelling variants
4. the `arabic` text search config produces lexemes
5. profiles auto-provision on signup
6. `capture_note` is idempotent on `client_id`
7. cross-user reads are blocked on `notes`, `note_tags`, `note_embeddings`
8. the generated `search_vector` is populated
9. lexical search matches across spelling variants
10. an unenriched note is still findable
11. tag variants collapse to a single tag
12. **every** public table has RLS enabled

Check 12 is the one that catches the real mistake: adding a table later and
forgetting its policy.
