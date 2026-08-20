# 1. System Architecture

## The problem this shape solves

The user thinks in Arabic and has ADHD. A thought has a short window before it
is gone, and any friction inside that window — unlocking, navigating, choosing
a folder — loses it. So the architecture optimizes for one thing above all:
**the time between deciding to capture and the thought being durable.**

Everything else (transcription, classification, tagging, retrieval) happens
after that moment and can take as long as it needs.

## Shape

```
┌─ React PWA (installable: iOS · Android · desktop browsers) ┐
│  Capture → IndexedDB (durable) → render immediately        │
│  Outbox replay → server, when connectivity allows          │
│  Vite · Intl.PluralRules · dir-driven CSS logical props    │
└───────────────┬────────────────────────────────────────────┘
                │ HTTPS · JWT
┌───────────────▼───────────────────────────────────────────┐
│  Supabase                                                  │
│   PostgREST    CRUD under RLS                              │
│   Storage      private `audio` bucket, signed URLs         │
│   Edge Funcs   notes · transcribe · enrich · search · digest│
│   pg_cron      weekly digest trigger                       │
│   Postgres     pgvector · unaccent · pg_trgm               │
└───────────────┬───────────────────────────────────────────┘
                │ server-side only — no vendor key reaches the client
   ┌────────────┼──────────────┬───────────────┐
   ▼            ▼              ▼               ▼
ElevenLabs   Anthropic      Cohere        (phase 2)
  Scribe     Sonnet 5    embed-multi-v3    translation
   ASR      enrichment      vectors
```

## Three decisions that shape everything else

### 1. Local-first capture

The client writes to IndexedDB before it attempts any network call
(`web/src/data/outbox.ts`). The UI renders from local state, so capture
latency is storage latency, not network latency — and works identically in a
basement or on a plane. Verified in a browser with no server running.

The consequence that drives the schema: the client mints a `client_id` (UUID)
at capture time, offline. That id is the idempotency key for replay. Without
it, every retry of an unacknowledged request is a duplicate note, and an
unreliable connection quietly multiplies the user's notes.

### 2. Language is resolved once, at the edge, and then carried

There is exactly one language decision per request
(`supabase/functions/_shared/language.ts` → `resolveLanguage`). The resolved
tag is then passed explicitly into every downstream stage: transcription,
enrichment, embedding, storage, retrieval.

No stage infers language on its own. That is what prevents the classic
multilingual failure where audio is transcribed under one language and
summarized under another, producing output that is wrong in a way nobody
notices until a user complains.

Phase 2 is a one-line change: flip `en.enabled` to `true` in the registry.
The pipeline stages do not change, because none of them contains the string
`"ar"`.

### 3. Vendor keys never leave the server

The PWA bundle ships the Supabase anon key and nothing else. Anything with a
`VITE_` prefix is compiled into JavaScript any visitor can read, so that
boundary is enforced by convention *and* by what is never put behind it:
ElevenLabs, Anthropic, and Cohere keys live only in Edge Function secrets.

The anon key is safe to ship **only because RLS is correct**. This is not
defense-in-depth — it is the authorization layer. See `docs/08-security.md`.

## Component responsibilities

| Component | Owns | Explicitly does not own |
|---|---|---|
| React PWA client | Capture, offline durability, rendering, direction | Any AI call, any vendor credential |
| PostgREST | Simple reads/writes under RLS | Anything needing a vendor key |
| Edge Functions | Vendor calls, multi-step orchestration, language resolution | Long-running work (that is batch/cron) |
| Postgres | Ownership enforcement, search fusion, tag identity | Business rules the client can vary |
| pg_cron | Weekly digest scheduling | Per-note work |

Edge Functions exist only where a vendor key or multi-step orchestration is
required. Everything else goes through PostgREST, where RLS enforces
ownership without any code to review.

## Data flow: one voice note

```
1. Client   record → IndexedDB (durable)       ~0 ms, offline-safe
2. Client   POST /notes            → note_id   idempotent on client_id
3. Client   POST /notes/audio-url  → signed URL
4. Client   PUT audio → Storage directly       bytes never touch a function
5. Server   POST /transcribe       Scribe → raw_text + confidence
6. Server   POST /enrich           Sonnet 5 → summary/category/tags/priority
                                   Cohere → 1024-dim vector
                                   SQL    → nearest-neighbour relations
7. Client   sees status: ready
```

Step 4 matters more than it looks: routing 25 MB of audio through an Edge
Function would burn function memory and cap recording length at the request
size limit. The client uploads to Storage directly under a signed URL scoped
to `<user_id>/`.

## Where the multilingual seams are

| Seam | File | Phase 2 change |
|---|---|---|
| Language registry | `functions/_shared/language.ts` | `en.enabled = true` |
| Client mirror | `web/src/core/language.ts` | same flag |
| Text normalization dispatch | migration `…000100` `normalize_for` | already handles Latin |
| Search config dispatch | migration `…000100` `ts_config_for` | already returns `english` |
| Per-language enrichment | `note_enrichments` (note, language) | new row, no migration |
| Per-language vectors | `note_embeddings` (note, language, model) | new row, no migration |
| UI strings | `web/src/i18n/en.ts` | already written |

Seven seams, all of them already exercised in phase 1 by the disabled-but-wired
`en` path. Code that has never run once is code that does not work; this is why
`en` is *defined* from day one rather than added later.
