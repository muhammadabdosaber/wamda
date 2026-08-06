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
| `GET` | `/export` | Every note, enrichment, and tag the caller owns. |
| `POST` | `/delete-account` | Irreversible. Requires `confirm_email`. |

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

### `GET /export`

Runs entirely under the caller's own client (RLS), never the service role —
the same reasoning `GET /notes` already uses, except here it is the whole
point: there is no `user_id` filter anywhere in the function because RLS is
the reason no other user's data is reachable, not a `.eq()` someone could
forget. Not paginated, and — unlike the timeline — includes `raw_text` and
archived notes. A data export that truncates bodies or drops archived notes
silently is not a complete export.

```jsonc
// 200
{
  "exported_at": "2026-08-07T12:00:00.000Z",
  "user_id": "uuid",
  "notes": [
    {
      "id": "uuid", "client_id": "uuid", "source": "text" | "voice",
      "status": "queued" | "ready" | "failed" | "…",
      "input_language": "ar", "detected_language": "ar" | null,
      "raw_text": "…" | null,
      "client_created_at": "…", "created_at": "…",
      "archived_at": "…" | null, "completed_at": "…" | null,
      "enrichments": [
        { "language": "ar", "title": "…" | null, "summary": "…",
          "category": "task", "priority": "normal",
          "suggested_action": "create_task", "action_due_at": "…" | null,
          "context": { "people": [], "places": [], "artifacts": [], "open_questions": [] },
          "model": "claude-opus-5" }
      ],
      "tags": [ { "slug": "…", "labels": { "ar": "…" } } ]
    }
  ]
}
```

`enrichments` is an array, not a single object — a note can carry more than
one row (`note_enrichments`'s unique key is `(note_id, language,
prompt_version)`), and a complete export does not pick one arbitrarily.
Deliberately excludes `note_embeddings` (an internal artifact, not something
a human exports) and `ai_jobs`/`weekly_digests` (telemetry and derived
content, out of this task's scope — SB-014 names notes, enrichments, and
tags specifically).

### `POST /delete-account`

```jsonc
// request
{ "confirm_email": "the caller's own email, typed back exactly" }

// 200
{ "deleted": true }

// 400 — wrong or missing confirm_email
{ "error": { "code": "confirmation_mismatch" } }
```

Irreversible, so this endpoint **is** the confirmation step, not a
placeholder for one a UI adds later — it refuses to act unless the email
matches the caller's own authenticated session exactly (fetched server-side,
never trusted from the request body alone).

The deletion itself is one call, `auth.admin.deleteUser()`, which cascades
through every table with `references auth.users (id) on delete cascade` —
notes, enrichments, tags (and labels through them), embeddings, relations,
digests, `ai_jobs`, `profiles`. That cascade already existed
(`docs/08-security.md`); this endpoint's own job is the Storage audio
objects, which no Postgres FK reaches, deleted first so a failure there
leaves the account — and the ability to retry — intact.

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
| `rate_limited` | 429 |
| `confirmation_mismatch` | 400 |
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
