# Changelog

Notable changes, newest first. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the project is pre-release and
unversioned, so entries are grouped by change rather than by release.

**House rule:** an entry says what *ran*, not what was written. If something was
added but never executed, say so — that distinction is the whole point of
`docs/00-verification.md`.

## Unreleased

### Added — per-user rate limit on `/enrich` and `/transcribe` (SB-002)

Both endpoints called paid vendor APIs with no bound: a runaway client loop
was a runaway bill. Closed with no new infrastructure — `ai_jobs` already
records every attempt, so it is the counter.

- **`public.rate_limit_hit(user_id, stage, limit, window_minutes)`**
  (migration `20260806000100_rate_limit.sql`) — a single SQL function, the
  same "one place, provable live" pattern as `notes_missing_embeddings`.
  Counts a user's `ai_jobs` rows for a stage in the trailing window.
  Pipeline-internal, not granted to `authenticated`.
- **`supabase/functions/_shared/rateLimit.ts`** — `enforceRateLimit()` calls
  it after note ownership is verified and before the pipeline runs. On a hit:
  `HttpError(429, "rate_limited")`, plus its own `ai_jobs` row so the
  rejection is itself observable. On a check failure: fails **open** — a
  broken telemetry read must not itself block a legitimate call, the same
  reasoning `recordJob` already uses.
- **Threshold: 60 calls / 15 minutes, per user, per stage.** Sized so the
  client's own sequential outbox replay (up to ~50 notes after a long offline
  stretch, SB-024) clears it comfortably, while a genuine runaway loop still
  trips it well short of real cost.
- **Wired into both endpoints** — `enrich/index.ts` and `transcribe/index.ts`
  — identically, right before `runEnrichment`/`runTranscription`.

**Proven, not just written:**

- `verify.sql` (live Postgres): trips exactly at the Nth call and not before;
  counters are scoped per stage, not shared across a user's stages; calls
  outside the window don't count.
- **61 real sequential `POST /functions/v1/enrich` calls** against the running
  local stack, under a locally-minted JWT for the real owner account (no
  client session exists in this worktree). Calls 1–60 reached the vendor path
  and failed on the missing key (`500 missing_configuration` — proof they got
  that far); call 61 was rejected by the gate itself, before `runEnrichment`
  was called (`429 rate_limited`). `ai_jobs` matched exactly: 60 + 1. The
  note's own status was untouched throughout. Test rows deleted afterward.
- **Not proven:** behavior under real concurrency (all 61 calls were
  sequential) or real vendor latency (every call here failed fast). Recorded
  honestly as a gap, not silently assumed away.

Evidence: `docs/00-verification.md`, "SB-002 · Per-user rate limit".

### Verified — the sweep schedule recovered a stranded note on its own timer (SB-001)

The claim every earlier sweep note deferred — *a `pg_cron` job fires by itself
and rescues a note with no client open* — now has evidence, not just a
mechanism. Nothing in the code changed; the migration was already on `main`.
What ran, on the local stack (2026-08-06):

- Set the two Vault secrets the migration reads at call time — the sweep URL
  pointed at kong via `host.docker.internal:54421`, and the local service-role
  key — then re-ran the `do` block of `20260801000800_sweep_schedule.sql`. It
  took the scheduled branch and registered `sweep-worker` (`*/5 * * * *`).
- A note stranded in `enriching` with a 15-minute-old `updated_at` was returned
  to `queued` **by the cron's own timer** — no browser, no hand-fired command.
  Proof from three angles: `cron.job_run_details` runid 3 `succeeded` at
  18:35:00 UTC; `net._http_response` `200 {"unstuck":1,...}`; the note's status
  and `updated_at` flipped at that same instant.
- **What did not run:** the retry pass that follows the unstick tried to enrich
  the two genuinely-stranded `queued` notes and failed with
  `missing_configuration` — this environment has no vendor keys — so they
  returned to `queued`, not `failed`. Only the *unstick* arm is proven live;
  enrich/embed still wait on SB-005/SB-007, and a hosted run on SB-016.
- Left inert afterward on purpose: `sweep-worker` unscheduled and both secrets
  deleted, so a keyless `*/5` does not drive real notes to the 5-attempt
  `failed` cap. `cron.job` and `vault.secrets` are empty again.
- **Operational note:** the local stack had last been started from a since-
  deleted worktree, so kong could not mount its email template and stayed down
  (exit 127). A `supabase stop && supabase start` from a live checkout rebuilt
  the containers with valid mounts; the database volume (14 real notes) was
  untouched. Same class of breakage recorded before under the owner's test
  session.

Evidence: `docs/00-verification.md`, "SB-001 · A note recovered by the schedule".

### Fixed — a captured note that fails enrichment no longer vanishes (SB-032), and capture confirms by showing the note again

Owner feedback the moment the redesign hit his own stack: he added two notes,
they "weren't added", and the save gave no sign it worked.

- **The notes *were* saved** — synced to the server — but their enrichment
  failed (`ai_jobs`: `stage=enrich, error_code=missing_configuration`, no
  `ANTHROPIC_API_KEY` in this environment), so they stalled at `status=queued`.
  The timeline only returned `ready` notes, so they were invisible in both the
  list and the outbox: exactly SB-032.
- **Fix (SB-032):** `functions/notes` timeline now returns every non-archived
  note, not just `ready`. A note with no enrichment renders as a processing
  card; a `failed` one says so honestly (`statusFailed`) rather than claiming to
  still be analysing. Verified: two stranded notes reappeared as "جارٍ التحليل…".
- **Reverted the SB-037 capture change.** Dropping the hand-off to the notes tab
  for an in-place "تم الحفظ" read as *failure* to the owner. Capture hands off to
  the notes tab again — with SB-032, the just-captured note is right there at the
  top of the list, which is the strongest confirmation there is. The in-place
  toast and its unused `captureSaved` string / `.saved-status` style were removed.
- **Note for operators:** enrichment cannot run without
  `supabase/functions/.env` carrying `ANTHROPIC_API_KEY`; until then every new
  note shows as "processing". That is now visible rather than silent.

### Added — the Tasks screen, note detail, and answered-suggestion feedback (SB-036, SB-037, SB-038, SB-033, SB-021, SB-023)

Completes the redesign's behavioural surfaces, on top of the theme (SB-031a).

- **Tasks screen (SB-036)** — a fifth tab, `web/src/features/Tasks.tsx`. A
  *filter over notes*, not a container (ADR-0004): notes whose enrichment reads
  `category = 'task'`, grouped by `action_due_at` into اليوم / هذا الأسبوع /
  لاحقًا, overdue folding into today. No new column and no new endpoint — it
  reuses the timeline. Priority rail per row (`urgent`→`--danger`,
  `high`→`--secondary` #56642b, `low`→`--border`, `normal`→none). Open-count per
  group uses a new `taskCount` plural; **verified on real data rendering the
  `one`, `two`, and `few` Arabic forms** (1, 2, 3 tasks).
- **`completed_at` (SB-038)** — migration `20260804000100`; a task can be ticked
  done. Distinct from `archived_at` (which is "gone for good"). Completion
  writes optimistically and **persists across reload** (verified).
- **Column-scoped update grant (SB-023)** — migration `20260804000200` revokes
  the blanket `update` on `notes` and re-grants only
  `(archived_at, action_dismissed_at, completed_at, updated_at)`. An
  authenticated client can no longer set `status`, rewrite `raw_text`, or forge
  `client_created_at`. Asserted in `verify.sql` (**PASS**).
- **Note detail (SB-037 / SB-021)** — `web/src/features/NoteDetail.tsx`. Tapping
  a task row or a note card opens the source note: the exact `raw_text`
  captured, its date, and the AI's read side by side. The timeline still omits
  `raw_text`; this is a single-row PostgREST read under RLS.
- **Answered-suggestion feedback (SB-033)** — accepting or dismissing a
  suggestion now shows a visible "تمّت / تم التجاهل" resolved state with an undo,
  instead of two links silently vanishing. `restoreNoteAction` clears the
  timestamp. Verified: click → resolved line appears → undo restores the chips.
- **Capture confirms in place (SB-037)** — the save no longer hands off to the
  notes tab; capture stays put and shows "تم الحفظ ✓", so the next thought goes
  straight in. Verified: app stays on the capture tab, textarea clears.

### Added — self-hosted fonts, and a CDN dependency removed (SB-011)

- The app now bundles **Public Sans** (Latin) and **Noto Sans Arabic** (Arabic),
  self-hosted woff2 in `web/public/fonts/`, split by `unicode-range` so each
  glyph picks the right face. Both are variable (weight 400–700, one file each);
  ~189 KB total, precached by the service worker.
- **Removed the Google Fonts `<link>`** from `index.html` that pulled IBM Plex
  Sans Arabic over a CDN — a network dependency that failed the instant the user
  was offline, in an offline-first PWA. Verified: no request to `fonts.gstatic`
  / `fonts.googleapis`, and Arabic renders in Noto (measured, not assumed).
- Retired the unused `amiri-*.woff2` that were sitting inert on disk; the
  redesign's face is Public Sans, not Amiri.

Verified end to end in a browser against the live local stack: `npm run verify`
(typecheck + RTL guard + 22 tests + build) and `verify.sql` (**ALL SCHEMA CHECKS
PASSED**, including the new grant + `completed_at` assertions). Tasks grouping,
completion + reload persistence, note-detail raw text, resolved state + undo,
in-place save, RTL↔LTR rail mirroring, and dark mode all driven and read back
via the browser tools.

### Added — the Stitch design export, and its theme (SB-031a)

- `docs/design/` carries three screens exported from Google Stitch (Capture,
  Notes, Tasks). The three `DESIGN.md` files are byte-identical, so the theme
  is unambiguous. `docs/design/README.md` records the rule we settled on:
  **theme only** — where the export contradicts behaviour that is already built
  and tested, the built behaviour wins.
- `web/src/styles/global.css` now carries the "Forest Edition" palette, the
  design's type scale and spacing scale, and its squarer radii (16px → 8px).
  PWA `theme_color` and `<meta name="theme-color">` follow.
- New tokens `--border`, `--surface-sunken`, `--on-accent`, `--on-danger`,
  `--danger-ink`, and the design's `--stack-*` / `--gutter` scale.

### Changed — what we did not take from the design

The export costs one tap per capture (it replaces the autofocused textarea with
a button), deletes the accept/dismiss buttons from note cards, ships no dark
palette, names three fonts that carry no Arabic glyphs, and specifies
line-heights between 1.33 and 1.5 that clip Arabic diacritics. None of that was
adopted. Its `rtl:flex-row-reverse` double-reverses an already-mirrored flex row
— a bug visible in its own `screen.png` — and its search field is written in
physical properties that break under `dir=ltr`.

Verified: typecheck, RTL guard, 21/21 tests, build, and the capture screen
driven in a browser at 375×812 in **both** colour schemes, with every colour
read back from `getComputedStyle`.

Two bugs this caught, both introduced by the port and both fixed before commit:
a `*/` inside a comment silently truncated the stylesheet (bundle 7.09 → 6.75
KB once fixed), and `color: #fff` hardcoded on `.btn` made every filled button
**1.70:1** under the new dark palette, where `--accent` inverts to a light sage.
Measured again in the live page after the fix: **10.56:1**.

**Not verified:** Chromium only, 375×812 only. The notes and tasks screens have
not been built, so nothing here shows the theme on a card-dense screen.

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
  against a real Postgres. All three jobs green on a real runner; the 12 schema
  assertions reproduced there, ending in `ALL SCHEMA CHECKS PASSED`.

### Fixed — what CI caught on its first run

- **`npm:@anthropic-ai/sdk` was unpinned.** The runner resolved 0.115.0, where
  the usage counters are `number | null`, and `deno check` failed on
  `pipeline.ts:324` — code that passes locally. Pinned to `0.115.0`, and
  `EnrichOutput.usage` widened to match the SDK; `costUsd` and both `ai_jobs`
  writes already treated those fields as nullable, so this declaration was the
  odd one out. No behaviour change: nothing outside `pipeline.ts` reads it.
- **The CI workflow had two faults of its own.** `version: latest` for the
  Supabase CLI resolves through an unauthenticated GitHub API call and was
  rate-limited; the `if: always()` stop step then ran a CLI that was never
  installed. CLI pinned to 2.109.1, stop step made tolerant.
- `.github/` PR and issue templates.
- `.claude/agents/second-brain-builder.md` and `second-brain-verifier.md` — the
  continuation agents.

Documentation only; no application behaviour changed. The `docs/16-glossary.md`
enum tables were corrected against
`supabase/migrations/20260801000200_enums_and_tables.sql` and
`web/src/i18n/ar.ts` after an initial draft got them wrong.

### Added — a schedule for the sweep worker

- `supabase/migrations/20260801000800_sweep_schedule.sql` — a `pg_cron` job
  that POSTs to the deployed `sweep` function every 5 minutes through
  `pg_net`. The function URL and service role key are read from **Vault at
  call time**, never embedded in the committed file; with either secret
  absent the migration raises a `NOTICE` and leaves the job unscheduled
  rather than failing the deploy. `cron.schedule` replaces by name, so it is
  re-runnable once the secrets exist.

Verified in CI: the migration applies to a fresh Postgres, logs the
`sweep-worker cron job NOT scheduled` notice, and the run still ends in
`ALL SCHEMA CHECKS PASSED` — the safe path reproduced on a machine that never
had secrets.

**Not verified: sweeping.** No cron job has ever fired and no note has ever
been recovered with no client open. That needs the two Vault secrets in an
environment that should really sweep (SB-001).

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
