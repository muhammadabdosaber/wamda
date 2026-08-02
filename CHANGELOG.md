# Changelog

Notable changes, newest first. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the project is pre-release and
unversioned, so entries are grouped by change rather than by release.

**House rule:** an entry says what *ran*, not what was written. If something was
added but never executed, say so — that distinction is the whole point of
`docs/00-verification.md`.

## Unreleased

### Added — note actions and capture feedback (PR #3, open)

- `notes.action_dismissed_at` (migration `20260802000100_note_action_state.sql`)
  records that the user responded to a suggested-action chip, keeping
  `note_enrichments` read-only to the client.
- `archiveNote` / `dismissNoteAction` in `web/src/data/api.ts`; the chips in
  `Notes.tsx` now do something, with a per-card busy and error state.
- `Capture.tsx` shows a "جارٍ الحفظ…" state and locks the input while saving;
  `App.tsx` hands off to the notes tab afterwards.

Verified: typecheck, 21/21 tests, RTL guard, and the save → lock → redirect flow
driven in a browser in unconfigured mode. **Not verified:** the migration has
been applied nowhere, so archive and dismiss have never run against a real
database (SB-029).

### Fixed — capture latency, and the reason it was traded away (SB-024, SB-025)

- Capture releases on the IndexedDB write again; `sync()` runs behind it,
  unawaited. PR #3 had made it await a full outbox drain — **measured at
  6 640 ms per note** against the live local stack, so a 21-note backlog would
  have locked the composer for about two minutes.
- The notes timeline now renders unsynced outbox rows beside server rows,
  deduped by `client_id`. This is what made the awaited sync unnecessary, and
  it fixes a worse case on its own: an offline user saw an empty list while
  their notes sat safely on the device.
- `sync()` emits `sb:synced`, so a local placeholder becomes its enriched card
  without a manual refresh.
- `readOnly` instead of `disabled` on the textarea — a disabled field loses
  focus, which closes the keyboard on a phone.
- A failed local write keeps the text and shows an error instead of clearing
  the field silently.

Measured after the fix: **95 ms** from Save to the note on screen with 8 notes
still queued. Verified offline, online, and across a reload; archive confirmed
persisting server-side; 42 enrichments succeeded beside 42 failed embeddings
with every note still reaching `ready`.

### Added — project documentation and agent handoff

- `CLAUDE.md` — repository guide for agents: read order, the five rules, the
  traps that have cost real time.
- `docs/10-product-spec.md` — problem, principles in priority order, journeys,
  scope, success metrics (none instrumented yet), product risks.
- `docs/11-features.md` — full feature inventory, 74 entries, each marked
  `working` / `partial` / `built, unrun` / `not built`.
- `docs/12-roadmap.md` — milestones M0–M7, each with an observable exit
  criterion.
- `docs/13-tasks.md` — the backlog: SB-001…SB-022, with acceptance criteria and
  a starting file each.
- `docs/14-testing.md` — the four test layers, and what is deliberately not
  automated.
- `docs/15-runbook.md` — local stack, deploy steps, and the failures that have
  actually happened here.
- `docs/16-glossary.md` — domain terms, Arabic normalization terms, and the
  real enum keys with their Arabic labels.
- `docs/adr/` — seven decision records written retroactively from the design
  docs: local-first capture, language as a parameter, Supabase + RLS, flat
  notes, hybrid search, PWA over native, stage isolation.
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`.
- `.github/workflows/ci.yml` — web verify, `deno check`, and `verify.sql`
  against a real Postgres. **Never executed on a runner.**
- `.github/` PR and issue templates.
- `.claude/agents/second-brain-builder.md` and `second-brain-verifier.md` — the
  continuation agents.

Documentation only; no application behaviour changed. The `docs/16-glossary.md`
enum tables were corrected against
`supabase/migrations/20260801000200_enums_and_tables.sql` and
`web/src/i18n/ar.ts` after an initial draft got them wrong.

### Added — sweep worker

- `supabase/functions/sweep` — unsticks notes stranded in
  `transcribing`/`enriching`, retries stale `queued` notes, and backfills
  `note_embeddings` for `ready` notes whose embedding stage degraded, via
  `notes_missing_embeddings()` (migration `20260801000700_sweep.sql`).
- Retries capped at 5 failed attempts per (note, stage), read from `ai_jobs`;
  past the cap the note is marked `failed` rather than retried forever.
- Pipeline logic shared by `enrich`, `transcribe`, and `sweep` moved into
  `_shared/pipeline.ts` — one copy, not two.

Verified locally end to end against a fresh `supabase db reset`: stuck-note
unstick, queued retry with grace period, retry-cap-to-`failed`, embedding
backfill. Enrichment and embedding calls themselves only exercised the failure
path — no vendor keys in that worktree.

**Still open:** nothing schedules it. No `pg_cron` job exists in any migration
(SB-001); the digest has the same gap.

### Added — first working system

- Postgres schema with Arabic normalization, generated search vectors, RLS on
  every table, and hybrid-search RPCs. 12 assertions pass against a live
  database.
- Five Edge Functions: `notes`, `transcribe`, `enrich`, `search`, `digest`.
  Type-checked against the real Anthropic SDK typings.
- React 19 + Vite PWA: Arabic RTL, offline capture to IndexedDB, outbox replay,
  i18n with correct Arabic plurals. 21 tests, RTL guard, 124 KB gzipped build.
- Email OTP auth with an Arabic RTL template — verified end to end through a
  local mail catcher.
- AI enrichment **run for real** on Claude Opus 5: two Arabic notes reached
  `ready` with correct categories, priorities, tags, and a resolved relative
  date ("الخميس" → the correct upcoming Thursday in `Asia/Dubai`).
- Prompt caching **measured** at ~2169 cached tokens per call; cost
  $0.008–0.011 per note against a $0.015 estimate.

### Fixed — seven bugs found by running things

Missing table grants · PostgREST type inference through embedded relations ·
`Messages` type requiring equal *text* across catalogues · dual Vite type
identities · notes stranded in a non-terminal state on enrichment failure ·
`sync()` burning retry attempts while signed out · an optional stage treated as
fatal, discarding a paid-for enrichment. Details in
`docs/00-verification.md`.

### Not done

Nothing requiring `COHERE_API_KEY` or `ELEVENLABS_API_KEY` has ever run: no
embeddings, no semantic search, no note relations, no transcription, no
cross-lingual retrieval. The weekly digest has never executed. Never deployed.
