# Changelog

Notable changes, newest first. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the project is pre-release and
unversioned, so entries are grouped by change rather than by release.

**House rule:** an entry says what *ran*, not what was written. If something was
added but never executed, say so — that distinction is the whole point of
`docs/00-verification.md`.

## Unreleased

### Shipped — second design round: loader, nav icons, notes grid, avatar menu (SB-039…042)

Ported the two new Cool Slate exports, theme only, and drove all four in a
real browser on the local stack signed in as a real user.

- **Loader** (SB-039). The literal `…` on five screens is now a pulsing mark
  with a label and list-shaped skeletons — a card ghost for Notes, a 56px row
  ghost for Tasks. The export's skeleton is a *form*, drawn for the capture
  screen; copying it onto a list would promise a layout the data never takes.
  Verified by delaying the timeline fetch in-page to hold the state open.
- **Nav icons** (SB-040). `add_circle` · `description` · `check_circle`
  redrawn as inline SVG, plus a fully-rounded active pill. Redrawn rather than
  loaded: the export pulls Material Symbols from a CDN and the app ships
  `font-src 'self'`, so the glyphs would have been blocked in production.
- **Notes** (SB-041). Card grid (one column at 375px, two on desktop), a
  badge-and-time head row, a 3-line clamped summary, and a horizontally
  scrolling category filter bar. The bar is driven by the app's real seven
  categories with labels from the catalogue — not the export's four hardcoded
  Arabic strings — and only offers a chip for a category actually on screen.
  The accept/dismiss buttons were **kept**; the export drops them, and they are
  a working, owner-tested feature (SB-033).
- **Avatar menu** (SB-042). Sign-out moved out of the header and behind an
  avatar — it was the most destructive control in the app, one stray tap away.
  Escape closes it and returns focus to the trigger; it anchors to the avatar's
  trailing edge in both RTL and LTR. The avatar is inline SVG because the
  export's remote image is blocked by `img-src 'self'`.

Two leftovers from the Cool Slate rebrand fixed on the way past: the tab bar's
shadow and the detail sheet's scrim were both still Forest green. Nothing fails
when a shadow tint is wrong, which is how they survived the palette port.

Also recorded a real measurement trap: with the browser pane hidden the
renderer stops compositing, so CSS transitions freeze mid-flight and
`requestAnimationFrame` never fires. A computed-style read through a hidden
pane reported the wrong tab as active until the transition was neutralised —
the app was correct the whole time. See `docs/00-verification.md`.

### Shipped — SB-016 done: hosted Supabase + Cloudflare Pages, live at wamda-a8k.pages.dev

Migrations, all 8 Edge Functions, the real `ANTHROPIC_API_KEY` secret,
`ALLOWED_ORIGIN` locked to the real PWA origin, and live `pg_cron`
schedules (sweep every 5 min, digest weekly, `ai_jobs` retention daily —
all `active: true`) are running on a real hosted Supabase project, and the
PWA itself is live at https://wamda-a8k.pages.dev. Three real bugs found
and fixed by actually running the deploy, not reading it: (1) the hosted
project's default email provider rejected the custom OTP template — fixed
via Resend as custom SMTP; (2) `_shared/pipeline.ts` sent
`betas`/`fallbacks` unconditionally, which Sonnet 5 rejects (`400`) —
removed both; (3) `_shared/http.ts`'s `json()` used a CORS header frozen
at module load instead of computed fresh per request, which would have
made `ALLOWED_ORIGIN` unreliable — fixed. A real note went capture →
sign-in → enrich → `ready` from the production URL itself, no localhost
involved. See `docs/00-verification.md` "SB-016".

### Decided — switched the enrichment model from Opus 5 to Sonnet 5 (SB-034 revised)

Owner reviewed the SB-034 addendum data and chose Sonnet 5:
83.3% category/priority agreement with Opus 5, self-consistent on the
haircut-retry test that broke Haiku, ~0.6x Opus's per-token cost.
`ENRICHMENT_MODEL` in `_shared/enrichment.ts` changed to `claude-sonnet-5`.
No `PROMPT_VERSION` bump — `note_enrichments` is keyed on
`(note_id, language, prompt_version)`, not `model`, so existing Opus 5
enrichments are untouched; only new enrichments use Sonnet 5. Not yet
re-verified end to end against a live run — that happens as part of SB-016's
hosted deploy.

### Investigated — added Sonnet 5 to the Opus vs Haiku enrichment comparison (SB-034 addendum)

Re-ran SB-034's methodology fresh with all three models in one run (36 real
API calls against the owner's same 12 real notes): Sonnet 5 tracked Opus 5
at 83.3% category/priority agreement and stayed self-consistent on the
haircut-retry test that broke Haiku (task/task/task, matching Opus), at
~0.6x Opus's per-token cost — a real structural saving, not a caching
artifact, since Sonnet's cache minimum (1,024 tokens) clears this prompt
the way Haiku's (4,096) doesn't. No model swap made; this is evidence for
the owner's decision, not a decision.

### Decided — revised the enrichment cost target from < $0.015 to < $0.02

Root-caused the SB-020 finding first: split the 14 real successful `enrich`
calls by cache hit/miss — hits average $0.0094, misses $0.0220, a ~12.5x
rate difference on the cached system prompt (`PRICING.cacheWrite` vs
`cacheRead`, `_shared/pipeline.ts`). Anthropic's cache TTL is 5 minutes, and
this product's own design (capture whenever a thought occurs, ADR-0001)
spreads real notes through the day, so most `enrich` calls land outside any
5-minute window and pay the cache-write price. The old $0.015 target was a
2-note best-case spot-measurement (SB-000f) from calls fired seconds apart.
$0.02 is set at the measured cache-miss price, not a discount off it, so the
current $0.018827 average now reads as under target honestly. No change to
the enrichment model or prompt — Opus 5 stays (SB-034 already tested and
rejected a cheaper model on quality grounds); this is a target correction,
not a quality tradeoff.

### Added — success metrics: capture latency, stuck notes, cost per note (SB-020)

Scoped with the owner first: SQL views checked manually in Studio, no new
page, no digest folding. Capture latency (open → durable) is newly
instrumented client-side — `outbox.ts` times its own IndexedDB write and
sends it on sync; `stuck_notes` and `note_cost`/`cost_summary` are views
over data `ai_jobs`/`notes` already carried. Verified in a real browser
end to end (73 ms captured, landed in Postgres, picked up by the view
immediately) and deliberately broken once (`stuck_notes` missing its
archived-note exclusion, caught before trusting it). Two real findings:
2 notes have been stuck 38.6 hours, and average enrichment cost ($0.0188
over 11 real notes) is above the $0.015 target. Also fixed a real bug
found along the way: `create or replace function` with an added parameter
creates an ambiguous overload instead of replacing the function unless the
old signature is dropped first.

### Added — `failed_ai_jobs`, a queryable view of currently-failing pipeline stages (SB-019)

Scoped with the owner first: a view, not push alerting; `ai_jobs` only, the
functions' `console.log` calls stay free-text. Shows one row per note+stage
whose *latest* attempt is failed — a stage that failed then succeeded on
retry does not appear. Proven wrong on purpose first: a naive version
without the "latest attempt" logic was caught showing a fixed stage as still
broken, before the real view was verified clean. Read against the owner's
real `ai_jobs` data: 15 currently-failing note+stage pairs, all attributable
to known blockers (missing Cohere/ElevenLabs keys).

### Decided — staying on Claude Opus 5 for enrichment, not Haiku 4.5 (SB-034)

An abandoned branch had already swapped the model for a ~5x cost estimate
but never checked output quality and never merged. Measured it for real:
ran the production prompt/schema through both models against the owner's
12 real notes. `suggested_action` agreed only 25% of the time, and Haiku
classified three retries of the *same real event* (a haircut) as
`task`/`event`/`event` — inconsistent with itself, not just with Opus,
which called all three `task` correctly. Cost was 4.26x cheaper for Haiku
as measured (not the ~5x estimated) — Haiku 4.5's prompt-cache minimum
(4,096 tokens, confirmed against Anthropic's docs) is higher than the
system prompt itself (~2,169 tokens), so Haiku never benefits from caching
at all here, while Opus 5 (512-token minimum) does from the second call on.

Per the task's own standing rule — don't switch on price alone when a
wrong category means the user re-files things themselves — `ENRICHMENT_MODEL`
stays `claude-opus-5`. Full comparison: `docs/04-ai-pipeline.md` "Model
choice: Opus 5 vs Haiku 4.5 (SB-034)".

### Fixed — weekly digest silently stored fence-wrapped JSON as prose (SB-018)

The digest's `collect` step (`supabase/functions/digest/index.ts`) asks the
model for JSON but the Batch API has no structured-outputs equivalent to
enforce it. First real run: the model wrapped valid JSON in a ` ```json `
fence, `JSON.parse` threw, and the existing fallback (correctly, by design)
kept the raw text rather than dropping the week — but that meant the fence
and all ended up stored as the digest's single `headline` field.

- Strip a ` ```(json)? ... ``` ` fence before parsing; fall through to the
  old raw-text fallback only if what's left still doesn't parse.
- Re-run for real: a second batch parsed cleanly into
  `{headline, themes, open_loops, wins, suggestion}` from the owner's real
  notes, and the (previously never-exercised) `Digest.tsx` screen rendered
  it correctly in a real signed-in session.

Evidence: `docs/00-verification.md` "SB-018", `docs/04-ai-pipeline.md`
"Stage 6".

### Closed — SB-017 and SB-018 (weekly digest), for real

SB-017 had proven the schedule mechanism but was blocked on
`ANTHROPIC_API_KEY`, which turned out to not actually be missing — it was
sitting in the main checkout's `supabase/functions/.env` (gitignored, so a
`git worktree` never gets a copy) the whole time. Copied it into this
worktree, reloaded the stack, and both tasks closed with real evidence: a
real Anthropic Batch submission from `digest-enqueue` firing on its own
schedule, and a real collected digest a user can actually read. See
`docs/09-status-handoff.md` "Operational gotchas" for the worktree-`.env`
trap, recorded so it doesn't cost time again.

### Added — archive and dismiss now queue while offline (SB-028)

`archiveNote`, `dismissNoteAction`, and `restoreNoteAction` were direct
PostgREST writes that threw when unreachable — honest, but every other
mutation in this app is local-first.

- All three now share `writeNoteField()`: attempt the real write, and on any
  failure — offline, or a network error while nominally online
  (`navigator.onLine` is not trustworthy here either, see the comment in
  `Notes.tsx`) — queue it instead of throwing.
- New IndexedDB store, `noteActions`, keyed `noteId:field` — a later action
  on the same field overwrites an earlier queued one rather than racing it
  on replay (dismiss then undo, both offline, correctly collapses to a
  no-op instead of two conflicting requests).
- `sync()` replays the queue first, on the same reconnect trigger every
  other mutation already uses.
- **No UI code changed.** The existing optimistic update in `Notes.tsx` was
  already gated on the mutation function not throwing; making it not throw
  was the entire fix.

**Proven with the backend genuinely down**, not simulated: stopped the
`kong` container, dismissed a real note — the card updated immediately,
confirmed queued in IndexedDB, confirmed *not* yet on the server. Restarted
`kong`, called `sync()`, confirmed the queue drained and the server row now
carries the exact timestamp queued while offline — not a new one from the
replay. Reloaded the page: durable, not an in-memory illusion.

Evidence: `docs/00-verification.md`, "SB-028".

### Fixed — `vite dev` rendered a blank page under the CSP added for SB-003

Found live while building SB-028: `vite dev` on port 5174 served a page
where `#root` stayed permanently empty, no console error, nothing to
explain it. `@vitejs/plugin-react` injects an **inline** `<script>`
preamble into dev-served HTML for Fast Refresh
(`window.__vite_plugin_react_preamble_installed__`), which the strict
`script-src 'self'` (no `unsafe-inline`) added for SB-003 blocked outright
— silently, since an inline-script CSP block does not always surface as a
`securitypolicyviolation` the way a blocked `connect-src` request reliably
does. Every component module then failed importing with `"@vitejs/plugin-react
can't detect preamble"`, and `main.tsx` never reached `createRoot(...).render(...)`.

Two sources carried the header into dev, only one of which was intentional:
`server.headers` in `vite.config.ts`, and — unnoticed — the CSP meta-tag
plugin, whose `transformIndexHtml` hook runs during `vite dev` too, not only
`vite build`, without an explicit `apply` filter.

Fixed by removing the header from `server.headers` entirely and adding
`apply: "build"` to the meta plugin, so `vite dev` carries no CSP at all.
Correct on reflection, not a workaround: CSP protects the shipped app;
Vite's own dev-time tooling was never part of what ships. `vite preview` and
the built `dist/index.html` — the actual production-representative surfaces
SB-003's original proof rested on — were unaffected throughout; SB-003's
"dev mode re-checked" claim was corrected in place rather than left standing.

Evidence: `docs/00-verification.md`, the SB-003 correction and "SB-028".

### Added — weekly digest schedule, mechanism proven live (SB-017, blocked on a key)

Same gap, same mechanism as SB-001's sweep schedule, applied to `digest`'s
two actions. `20260807000300_digest_schedule.sql` schedules
`digest-enqueue` (Saturdays 03:00 UTC) and `digest-collect` (every 6 hours —
enqueue is weekly, but the Batch API can take up to 24h, so collect keeps
polling), both conditional on two Vault secrets read live at call time.

**Caught before it shipped:** a first draft used `format(...)` to bake the
actual secret values into the stored `cron.job` command text. That would
have put the service-role key in cleartext, readable by anyone who could
`select command from cron.job`, and needed the migration re-run on every key
rotation. Rewritten to match `sweep-worker`'s pattern exactly — a live
lookup subquery in the job body, never a baked-in literal.

**Proven live:** with the secrets set, both jobs were temporarily
fast-forwarded to fire every minute and both fired on their own timer within
the session — `cron.job_run_details` `succeeded` for each, `net._http_response`
confirming the real `digest` function was reached (`500
missing_configuration` — this worktree has no `ANTHROPIC_API_KEY`, so
`requireEnv` throws before either action's logic runs). Restored to the real
cadence, then unscheduled and secrets removed — same reasoning as SB-001,
nothing useful in leaving a keyless job to fail on a timer forever locally.

**Filed `blocked`, not `done`:** the mechanism works, but the task's actual
accept line — a real row in `digest_batches` — needs a real
`messages.batches.create()` call, which needs the key.

Evidence: `docs/00-verification.md`, "SB-017 · Schedule the weekly digest".

### Added — export everything and delete everything (SB-014, SB-015)

The two user-rights endpoints the product spec named from day one and had
never built.

**`GET /export` (SB-014).** Runs entirely under the caller's own client — no
service role, no `user_id` filter to get wrong; RLS is the reason no other
user's data is reachable, not application code remembering to check. Returns
every note the caller owns (including archived, unlike the timeline), with
full `raw_text`, every enrichment, and every tag with its labels. Format
documented in `docs/03-api.md`.

**`POST /delete-account` (SB-015).** Requires `confirm_email` to match the
caller's own authenticated email exactly — the endpoint *is* the
confirmation step, since no settings UI exists yet to put one in front of
it. The deletion itself is one call, `auth.admin.deleteUser()`, which
cascades through every table with a `references auth.users ... on delete
cascade` FK (already true before this change). This task's own code is the
Storage audio cleanup, which no Postgres FK reaches — deleted first, so a
failure there leaves the account, and the ability to retry, intact.

**Proven with real data, not a mock:**

- `/export` called against the real owner's account: `200`, 13 KB, exactly
  their 14 real notes, correctly split 2 archived / 1 completed / 10
  enriched-and-tagged.
- Cross-user isolation for `/export` proven fresh with a disposable test
  user: empty before they had data, exactly their own note after capturing
  one.
- `/delete-account` run through a full cycle on that same disposable user —
  given a real enrichment, tag, tag label, embedding, `ai_jobs` row, and a
  real uploaded audio object first. A wrong `confirm_email` was rejected and
  the account confirmed still present; the correct one deleted it. All 10
  tables checked (`notes` through `storage.objects`, including `auth.users`
  itself) read exactly zero afterward, and a direct `GET` on the deleted
  audio object returned `400` — the bytes are gone, not just the row.
- The real owner's 14 notes, `auth.users` row, and 2 real audio objects were
  confirmed present and untouched before and after.

Evidence: `docs/00-verification.md`, "SB-014/015".

### Added — audio retention actually enforced (SB-009)

`profiles.audio_retention_days` existed since the first migration and
nothing had ever read it — storing a user's voice longer than promised is a
privacy failure, not a cleanup task.

- **`public.notes_audio_expired()`** (migration `20260807000200_audio_retention.sql`)
  finds notes whose audio has outlived their own owner's setting — a
  per-user join, since retention is not a single global cutoff.
- **`sweep` now consumes it**: deletes the object from the `audio` bucket via
  the **Storage API**, then clears `notes.audio_path`. Deliberately not a raw
  SQL delete on `storage.objects` — that removes only the metadata row and
  orphans the bytes, the opposite of the goal. Reuses the existing sweep
  schedule; no new cron or Vault wiring needed.
- The note **survives with its transcript** — only `audio_path` is touched.

**Proven with a real upload and a real delete, not a mock:** uploaded an
actual object to the bucket via the Storage REST API, attached it to a note
backdated 40 days past the 30-day default, restarted the stack, and `POST
/sweep` returned `audio_purged: 1`. Confirmed three ways: the
`storage.objects` row is gone; a direct `GET` on the deleted object returned
`400` — the bytes themselves are gone, not just the catalog row; the note's
`raw_text` and `status` are unchanged. A second `sweep` call returned
`audio_purged: 0` (idempotent). A control note captured *today* with real
audio survived two sweep passes untouched — the boundary holds both ways.

Evidence: `docs/00-verification.md`, "SB-009 · Enforce audio retention".

### Added — `ai_jobs` retention (SB-004)

`ai_jobs` takes a row per stage per note per attempt and grew without limit.
`public.purge_old_ai_jobs(p_days default 90)` (migration
`20260807000100_ai_jobs_retention.sql`) deletes rows older than the window
and returns the count removed; `pg_cron` calls it daily at 03:00 UTC. No
Vault secrets needed — unlike the sweep/digest schedules this never leaves
Postgres, so it schedules unconditionally. Window recorded in
`docs/02-database-schema.md`'s new **Retention** section.

Proven live in `verify.sql`: a 120-day-old row and a 10-day-old row inserted,
the function called, the old one confirmed gone and the recent one confirmed
to survive. Confirmed on the running local stack too — `cron.job` shows it
scheduled and active, and the owner's 57 real `ai_jobs` rows (oldest from
2026-08-02) were untouched, correctly, since none are near 90 days yet. Left
scheduled — no reason to turn it off, unlike SB-001's sweep.

Evidence: `docs/00-verification.md`, "SB-004 · `ai_jobs` retention".

### Added — `ALLOWED_ORIGIN` now actually gates the preflight (SB-010)

Before, `ALLOWED_ORIGIN` only decorated the CORS header value — every
`OPTIONS` preflight still got a `204` no matter who asked, leaving
enforcement entirely to the calling browser honouring a mismatched
`Access-Control-Allow-Origin`. Now `preflight()` in `_shared/http.ts` rejects
a foreign or missing `Origin` at `403`, before any header naming the real
origin is ever sent back. Unset (every environment today) stays permissive.

**The first `deno test` in this project** (`_shared/http.test.ts`, 5 cases,
no framework import so it needs no network access) — proven the same way
`check-rtl.mjs` was proven: the old, unguarded code was swapped back in and
3 of 5 tests correctly failed, then the fix restored and all 5 passed. Wired
into CI alongside `deno check`. Also confirmed live against the real local
Edge Runtime after a full restart.

Evidence: `docs/00-verification.md`, "SB-010 · Pin `ALLOWED_ORIGIN`".

### Added — strict Content-Security-Policy (SB-003)

Load-bearing, not hardening: `supabase-js` keeps the session in
`localStorage`, so a single XSS is a full session compromise — CSP is the
control actually protecting it, per `docs/08-security.md`.

- **One policy, built once** in `web/vite.config.ts` from `VITE_SUPABASE_URL`,
  applied to `vite dev`, `vite preview`, and injected as a `<meta>` tag into
  the built HTML, so the three can never drift apart. No `unsafe-inline`, no
  `unsafe-eval`, no wildcard: `default-src 'self'`; `connect-src` adds only
  the Supabase origin; `object-src 'none'`; `base-uri`/`form-action 'self'`.
- **Removed the app's only 4 inline styles** (`Auth.tsx`, `Capture.tsx`) to
  actually reach zero `unsafe-inline` — moved to CSS classes carrying the
  exact same values, not a design change.
- **`securitypolicyviolation` listener** in `main.tsx` — console-visible
  reporting, since a `<meta>` CSP cannot carry `report-to`.

**Proven, not just configured:** header confirmed byte-for-byte via `curl -I`
on both `vite dev` and a real `vite preview` build. A genuine cross-origin
auth call (`POST .../auth/v1/otp`, different origin than the page) succeeded
under `connect-src`. Then, matching how `check-rtl.mjs` was proven — a
deliberate violation: `fetch("https://example.com/")` was blocked, and the
violation listener caught it with `disposition: "enforce"`, confirming this
blocks rather than merely reports. Dev mode (HMR, React Fast Refresh)
re-checked separately under the same header — nothing needed relaxing.

**Honest gap:** `frame-ancestors` and `report-to` cannot live in a `<meta>`
tag at all (spec limitation) — the served header carries `frame-ancestors
'self'`, the built HTML's fallback does not. Whatever host SB-016 deploys to
must set both at its own header layer.

Evidence: `docs/00-verification.md`, "SB-003 · Strict CSP".

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
