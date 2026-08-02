# 3. API

Base: `/functions/v1`. Auth: Supabase JWT in `Authorization: Bearer`.

## Language parameter

Every endpoint accepts `lang` (query string or body) and honours
`Accept-Language`.

**Resolution order — explicit → profile → `Accept-Language` → `'ar'`.**

Implemented once in `functions/_shared/language.ts`, mirrored client-side in
`web/src/core/language.ts`, and both are covered by tests asserting the
same precedence.

Two rules that matter:

- **Every response echoes the language it was served in**, plus `direction`
  (`rtl`/`ltr`) and a `Content-Language` header. The client never has to infer
  which language it got back — inference is precisely where a half-Arabic,
  half-English screen comes from.
- **A requested-but-disabled language falls through rather than erroring.** In
  phase 1 a browser sending `Accept-Language: en` gets Arabic, not a 400.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/notes` | Capture. Idempotent on `client_id`. |
| `GET` | `/notes?lang=&cursor=&limit=` | Timeline, keyset-paginated. |
| `POST` | `/notes/audio-url` | Signed upload URL for a voice note. |
| `POST` | `/transcribe` | Audio → text (stage 1). |
| `POST` | `/enrich` | Enrichment + embedding + relations (stages 3–5). |
| `POST` | `/search` | Hybrid / semantic / lexical retrieval. |
| `POST` | `/digest` | `{action: "enqueue" \| "collect"}` — cron-triggered. |

### `POST /notes`

```jsonc
// request
{ "client_id": "uuid",       // REQUIRED — minted by the client, offline
  "source": "text" | "voice",
  "text": "…",               // required when source = text
  "client_created_at": "2026-08-01T09:12:00Z",
  "lang": "ar" }

// 201
{ "note_id": "uuid", "client_id": "uuid", "source": "text",
  "language": "ar", "direction": "rtl" }
```

`client_id` is required rather than server-generated. That is the whole point:
the client created it before it had connectivity, so replaying an
unacknowledged request resolves to the same row instead of creating a second
note. Verified in `verify.sql`.

### `GET /notes`

Keyset pagination via `cursor` (a `client_created_at` value), **not** `OFFSET`.
`OFFSET` re-scans and discards every skipped row, so page 50 costs 50× page 1
— and it silently skips or repeats rows when notes sync in mid-scroll.

The response deliberately omits `raw_text`; the timeline renders summaries. On
a long scroll that is the difference between a 30 KB and a 900 KB response.

### `POST /search`

```jsonc
{ "q": "…", "lang": "ar",
  "mode": "hybrid" | "semantic" | "lexical",
  "categories": ["task"], "limit": 20 }
```

`lexical` mode skips the embedding call entirely — a keyword search should not
pay an embedding round trip. See `docs/04-ai-pipeline.md` for the fusion.

### Errors

```json
{ "error": { "code": "note_not_found" }, "language": "ar" }
```

**Bodies carry a machine code, never a human sentence.** A server-generated
Arabic message would be a second translation surface that drifts away from the
app's message catalogues. The client owns all user-facing text
(`errorLabel()` in `web/src/i18n/index.ts`); the server owns the code.

Internal errors are logged server-side and returned as `internal_error` —
stack traces and driver messages routinely contain table names, IDs, and
occasionally row data.

| Code | Status |
|---|---|
| `unauthenticated` | 401 |
| `note_not_found` | 404 |
| `note_has_no_text` / `note_has_no_audio` | 409 |
| `enrichment_refused` | 422 |
| `transcription_failed` / `embedding_failed` | 502 |
| `internal_error` | 500 |

## Idempotency

| Endpoint | Key | Behaviour on retry |
|---|---|---|
| `/notes` | `client_id` | Same `note_id`, no duplicate |
| `/transcribe` | existing `raw_text` | Returns cached, no ASR call |
| `/enrich` | `(note, language, prompt_version)` | Returns cached, no model call |

Transcription and enrichment are the billable stages, so "retry is free" is a
correctness *and* a cost property. `force: true` on `/enrich` overrides, for
re-running after a prompt change.
