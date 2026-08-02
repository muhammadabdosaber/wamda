# 16. Glossary

> Domain terms, Arabic terms, and the names this codebase gives things.
> Read this before writing code that touches language, tags, or note state —
> most of the subtle bugs in this project came from conflating two entries below.

---

## The one rule

**Never store a display label as a key.**

The database stores `'task'`. The Arabic word **مهمة** exists only in
`web/src/i18n/ar.ts`. That single rule is why adding English is a new catalogue
rather than a data migration, and why a note filed in Arabic is still filed
correctly when the UI language changes.

| | Key | Label |
|---|---|---|
| Lives in | database, API, code | `web/src/i18n/*.ts` |
| Example | `task` · `high` · `create_task` | مهمة · عالية · إنشاء مهمة |
| Changes when | the domain changes | a translation improves |
| Language | none | exactly one |

---

## Project terms

**Capture** — the act of getting a thought into durable storage. Ends the moment
the note is written to IndexedDB, *not* when the server acknowledges it. The
product's entire latency budget lives inside this word.

**Outbox** — the local queue of notes not yet acknowledged by the server
(`web/src/data/outbox.ts`). Survives reloads and offline periods; replayed on
reconnect and on sign-in.

**`client_id`** — a UUID minted by the client at capture time, offline. The
idempotency key for replay. Without it, every retry of an unacknowledged request
is a duplicate note.

**Enrichment** — the AI pass that turns raw text into title, summary, category,
priority, action, due date, and tags. One pass per note, at capture time.

**Stage** — one step of the pipeline (`transcribe`, `enrich`, `embed`, `relate`).
Stages 4–5 are *isolated*: their failure degrades the note rather than failing it.

**Terminal state** — `ready` or `failed`. Any other status means work is
in flight or stranded. A note left outside a terminal state is invisible to the
timeline, which is why the sweep worker exists.

**Sweep** — the worker that unsticks stranded notes, retries stale `queued`
ones, and backfills missing embeddings (`supabase/functions/sweep`). Nothing
schedules it yet.

**Degrade honestly** — on failure, produce a visibly partial note. Never a
fake-complete one, never an invisible one.

**Seam** — a place where the code branches on language. There are seven, listed
in `docs/01-architecture.md`. All exist in phase 1 even though only `ar` is
enabled, because code that has never run is code that does not work.

**Ledger** — `docs/00-verification.md`. The record of what actually ran.

---

## Note state machine — `note_status`

| Status | Meaning | Terminal |
|---|---|---|
| `draft` | created, not yet submitted to the pipeline | no |
| `queued` | captured, waiting for a stage | no |
| `transcribing` | ASR in flight | no |
| `enriching` | model call in flight | no |
| `ready` | usable: visible in the timeline and searchable | **yes** |
| `failed` | gave up — retry cap reached, or a refusal | **yes** |

A `ready` note may still be missing its embedding. That is a degraded success,
not a failure, and the missing row is its own backfill marker.

---

## Enum keys and their Arabic labels

Keys are the contract. Labels are presentation. If a label appears in a
migration, a function, or an API response, that is a bug.

### `note_category`

| Key | العربية |
|---|---|
| `task` | مهمة |
| `event` | موعد |
| `idea` | فكرة |
| `learning` | معلومة |
| `reference` | مرجع |
| `personal` | شخصي |
| `other` | أخرى |

### `note_priority`

| Key | العربية |
|---|---|
| `urgent` | عاجل |
| `high` | مهم |
| `normal` | عادي |
| `low` | لاحقًا |

### `suggested_action`

| Key | العربية |
|---|---|
| `create_task` | أضفها كمهمة |
| `create_event` | أضفها للتقويم |
| `archive` | أرشفة |
| `review_later` | راجعها لاحقًا |
| `none` | تجاهل |

### Others

`note_source`: `voice` · `text`
`relation_kind`: `similar` · `continuation` · `duplicate`
`job_stage`: `transcribe` · `detect_language` · `enrich` · `embed` · `relate` · `digest`
`job_status`: `pending` · `running` · `succeeded` · `failed`

> These tables are a reading aid, not the source of truth. The enums live in
> `supabase/migrations/20260801000200_enums_and_tables.sql`; the labels live in
> `web/src/i18n/ar.ts`. If they disagree with this file, this file is wrong.

---

## Arabic language terms

Terms you need to read the schema and the normalization code.

**Normalization** — folding spelling variants so that text stored one way is
found when typed another. Implemented in `normalize_for` / `normalize_ar`
(migration `…000100`) and verified against real data.

| Term | Sign | What folds |
|---|---|---|
| **Alef hamza** | أ إ آ → ا | hamza forms collapse to bare alef |
| **Taa marbuta** | ة → ه | word-final taa marbuta to haa |
| **Alef maqsura** | ى → ي | |
| **Tatweel / kashida** | ـــ | decorative elongation, removed |
| **Harakat** | َ ُ ِ ّ ْ | short-vowel diacritics, removed |

**Slugify** — normalization applied to a tag so variants converge on one tag.
Proven on real model output: `عروض-أسعار` (hamza) and `عروض-اسعار` (bare alef)
become the same tag instead of fragmenting the graph.

**RTL / LTR** — right-to-left and left-to-right text direction. Arabic is RTL.
The UI never uses physical CSS properties (`margin-left`); it uses logical ones
(`margin-inline-start`), which mirror automatically. `tool/check-rtl.mjs`
enforces this and has been proven to fail on a real violation.

**MSA vs dialect** — Modern Standard Arabic vs spoken varieties (the user speaks
Gulf/Egyptian-influenced Arabic). The Postgres `arabic` snowball stemmer handles
MSA reasonably and dialect less well; the semantic search arm is what covers the
gap. ASR quality on dialect is product risk #1 and is unmeasured.

**Cross-lingual retrieval** — one shared vector space for Arabic and English, so
an Arabic query can find an English note with no shared token. Assumed of Cohere
`embed-multilingual-v3.0`, **never tested** (SB-006). The phase-2 plan rests on it.

**Arabic plurals** — Arabic has four plural categories that occur in practice
(`one`, `two`, `few`, `many`), all driven by real `Intl.PluralRules` and all
verified rendering distinctly. Never build a plural by concatenating a number.

---

## Stack terms

**RLS** — Row Level Security. Here it is *the* authorization layer, not
defense-in-depth: the client ships an anon key, and RLS is the only thing
between it and other users' data.

**RRF** — Reciprocal Rank Fusion, how the lexical and semantic search arms are
combined into one ranking (migration `…000500`). Untuned — needs a real corpus.

**tsvector / tsconfig** — Postgres full-text search types. `ts_config_for(lang)`
returns `arabic` or `english`; `search_vector` is a generated column.

**pgvector** — the Postgres extension storing the 1024-dim embeddings.

**Edge Function** — a Deno function on Supabase. Exists only where a vendor key
or multi-step orchestration is needed; everything else goes through PostgREST
under RLS.

**PostgREST** — the auto-generated REST API over Postgres. Enforces RLS with no
application code to review.

**`ai_jobs`** — the telemetry table: one row per stage per note per attempt.
Also the retry-count source (cap: 5). Grows without limit today (SB-004).

**Prompt caching** — Anthropic serving a repeated system prompt at ~0.1× input
price. ~2.2K cached tokens per call here, measured. `prompt_cache_miss` in the
logs on anything but the first call means something volatile entered the prompt.

**PWA** — installable web app. Chosen over native, accepting the iOS cost: no
background sync, uncertain `MediaRecorder`, no install prompt (ADR-0006).
