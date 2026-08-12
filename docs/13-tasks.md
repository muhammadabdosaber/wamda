# 13. Task Backlog

> The single actionable list. Every task has a stable id, a milestone, an
> **acceptance criterion that can be checked by someone else**, and where to
> start. This is the file an agent picks work from.
>
> Rules: one task = one PR-sized change · never mark a task done without
> evidence in `docs/00-verification.md` · if a task turns out to be two tasks,
> split it rather than growing it.

Status: `todo` · `in progress` · `blocked` · `done`
Size: `S` < 1 session · `M` ~1 session · `L` multi-session

---

## ملخّص بالعربي

ده الملف اللي بتتاخد منه الشغلانة الجاية. كل مهمة ليها رقم ثابت، وشرط قبول
واضح يقدر حد تاني يتأكد منه. **متعلّمش مهمة إنها خلصت من غير دليل** مكتوب في
`docs/00-verification.md`.

ابدأ من أول مهمة `todo` في جدول "Next up".

---

## Next up

The ordering is by consequence, not effort. Take the first `todo` you are not
blocked on.

| # | Task | Milestone | Size | Status |
|---|---|---|---|---|
| SB-029 | Verify **dismiss** for real; migration exists only on the local DB | M1 | S | done |
| SB-023 | Column-scoped update grant on `notes` | M6 | S | **done** |
| SB-002 | Per-user rate limit on `/enrich` and `/transcribe` | M6 | M | **done** |
| SB-032 | Notes that sync but fail enrichment are invisible | M1 | S | **done** |
| SB-033 | An answered suggestion must show it was answered | M1 | S | **done** |
| SB-036 | Tasks screen — a filter over notes, not a container | M8 | M | **done** |
| SB-037 | Open the source note from a task row (+ SB-021) | M8 | M | **done** |
| SB-038 | `completed_at` so a task can be ticked — pair with SB-023 | M8 | M | **done** |
| SB-011 | Bundle the app fonts (Public Sans + Noto Sans Arabic) | — | S | **done** |
| SB-001 | Schedule the sweep worker | M5 | M | **done** |
| SB-003 | Strict CSP | M6 | M | **done** |
| SB-010 | Pin `ALLOWED_ORIGIN` | M6 | S | **done** |
| SB-004 | `ai_jobs` retention | M6 | S | **done** |
| SB-009 | Enforce audio retention | M6 | M | **done** |
| SB-014 | Export everything | M6 | M | **done** |
| SB-015 | Delete everything | M6 | M | **done** |
| SB-028 | Queue archive/dismiss while offline | — | S | **done** |
| SB-017 | Schedule the weekly digest | M5 | S | **done** |
| SB-018 | Run the digest once, for real | M5 | M | **done** |
| SB-019 | Queryable pipeline failures over `ai_jobs` | — | S | **done** |
| SB-020 | Instrument the success metrics | — | M | **done** |
| SB-039 | Loader: pulse mark + list-shaped skeletons, replacing `…` | — | S | **done** |
| SB-040 | Nav icons redrawn from the export; rounded active pill | — | S | **done** |
| SB-041 | Notes: card grid + scrolling category filter bar | — | M | **done** |
| SB-042 | Avatar button with a logout menu | — | S | **done** |
| SB-007 | ElevenLabs key → first real transcription | M3 | M | **done** |
| SB-005 | Cohere key → embeddings + semantic search | M2 | M | **blocked** |
| SB-006 | Cross-lingual retrieval test | M2/M7 | S | **blocked** |

> **SB-001 is done** (mechanism on `main` via #5; proven 2026-08-06).
> `20260801000800_sweep_schedule.sql` reads the function URL and service role
> key from Vault at call time rather than embedding either in a committed file,
> and when the secrets are absent it raises a `NOTICE` and leaves the job
> unscheduled instead of failing the deploy. `cron.schedule` replaces by name,
> so the file is re-runnable. **The part that mattered is now proven:** with the
> two secrets set on the local stack, the `*/5` `sweep-worker` job fired on its
> own timer (`cron.job_run_details` runid 3, 18:35:00 UTC), the call returned
> `200 {"unstuck":1,...}`, and a note stranded in `enriching` returned to
> `queued` **with no client open and nothing invoked by hand**. Evidence:
> `docs/00-verification.md` "SB-001 · A note recovered by the schedule". Left
> inert afterward (`cron.job`/`vault.secrets` empty) so a keyless local `*/5`
> does not drive real notes to the failed-attempt cap. Turning it on for real is
> still one secret-pair + migration re-run per environment (SB-016 for hosted).

---

## M2 — Enrichment and semantic search

### SB-005 · Embeddings and the semantic arm · `blocked` · M

Supply `COHERE_API_KEY` and run the embedding stage for real for the first time.

- **Blocked on:** the key. Nothing else.
- **Start at:** `supabase/functions/_shared/providers.ts`, `pipeline.ts` stage 4.
- **Accept:** `note_embeddings` has a 1024-dim row for every `ready` note;
  `functions/search` returns fused results with `p_embedding` non-null;
  `relate_note()` produces at least one real row.
- **Watch for:** the same class of bug as #7 in `00-verification.md` — an
  embedding failure must never lose the enrichment that already succeeded.

### SB-006 · Cross-lingual retrieval test · `blocked` · S

The highest-value unknown in the project, and it is one afternoon of work.

- **Blocked on:** SB-005.
- **Do:** store one English note and one Arabic note about the same subject with
  **no shared tokens**; query each in the other language.
- **Accept:** each query returns the other-language note in the top 3. Result
  written into `docs/00-verification.md` **whether it passes or fails**.
- **If it fails:** stop and re-plan M7. The "English costs no migration" claim
  is downstream of this single fact.

### SB-008 · Backfill embeddings for existing notes · `blocked` · S

- **Blocked on:** SB-005. The mechanism already exists —
  `notes_missing_embeddings()` + `sweep`, migration `…000700`.
- **Accept:** after one sweep run, zero `ready` notes are missing an embedding.

## M3 — Voice

### SB-007 · First real transcription · `done` · M

**Done (2026-08-11).** `ELEVENLABS_API_KEY` added; stack restarted (env vars
only load on a fresh `supabase start`, not `docker restart`). Re-ran
`transcribe` on the two `source = 'voice'` notes already in the local DB from
SB-012 — both succeeded for real (`provider: elevenlabs`, `model: scribe_v1`,
real latency), `raw_text` and `transcript_confidence` persisted, both
correctly held at `draft` (confidence under the 0.6 review threshold). The
response shape matched what `ScribeASR.transcribe` already assumed — no code
change needed — and is now recorded in `docs/04-ai-pipeline.md` Stage 1,
including that identical audio sent twice produced a different tag and
confidence each time. Evidence: `docs/00-verification.md` → "SB-007 · First
real transcription".

**Caveat carried forward, not closed here:** the two available clips turned
out to be silence/noise test recordings, not speech — this proved the
pipeline mechanics (auth, RLS, Storage, vendor call, confidence gating, status
transition) but not ASR quality on real Arabic speech. That gap is SB-013.

### SB-012 · Voice capture on a real phone · `in progress` · M

**Desktop Chrome fully proven (2026-08-11):** the local database holds voice
notes with real recordings uploaded, transcribed, and enriched end to end —
see SB-007.

**iPhone Safari: first real attempt made, two real bugs found and fixed, not
yet re-verified.** A real recording on the deployed production PWA
(`wamda-a8k.pages.dev`) from an iPhone found: (1) `audio_path` silently
failing to persist (SB-023's grant, fixed and deployed), then (2) the audio
itself silently rejected by Storage — iOS Safari's `MediaRecorder` reports a
codec-qualified MIME type (`audio/mp4;codecs=mp4a.40.2`) that fails the
bucket's exact-match `allowed_mime_types` check. Fixed in `Capture.tsx` /
`api.ts` (strip the codec suffix, derive the Storage extension from the real
MIME type, check the upload's result instead of discarding it). Verified
`npm run verify` clean and the fix's exact mechanism against the real bucket
(rejected with the codec suffix, accepted without it) — but **not yet
re-verified with an actual recording from the iPhone that found the bug**,
because the fix requires a new production deploy first.

**Deployed 2026-08-12; three further real bugs found, and the pipeline now
runs end to end on the hosted stack.** In order: (3) the hosted project was
missing `ELEVENLABS_API_KEY` entirely, so transcription had never once run in
production; (4) the diagnostic banner added to report these failures read
`error.context.error.code` off a raw `Response`, so every failure — whatever
it was — displayed as `internal_error`; (5) a stale session showed the app as
signed in while every call returned `401`, which sign-out/sign-in cleared. All
fixed. After that, a real laptop recording ran the full path for the first
time on hosted: upload → `transcribe` → ElevenLabs `200`, `scribe_v1`, 442 ms,
`ai_jobs.status = succeeded`.

**The transcript still came back empty — and the cause is not software.** The
stored audio was pulled from Storage and its container parsed byte by byte: a
valid 20.34-second WebM/Opus file whose 340 audio frames are all *identical*
minimum-size frames. That is exact digital silence; Opus is variable-bitrate,
so speech cannot produce uniform minimum frames. The microphone was delivering
no signal. Ruled out separately: the same bytes sent to ElevenLabs under both
`note.m4a` (what `providers.ts` hardcodes) and `note.webm` returned empty
either way, so the hardcoded filename is not the cause here — though it is
still wrong, and is listed below.

- **Blocked on:** hardware on the owner's laptop — the microphone input needs
  fixing before any transcript can be judged. Silence detection (below) now
  surfaces this immediately instead of producing an empty note.
- **Also open:** `providers.ts` sends every recording to ElevenLabs as
  `note.m4a` regardless of its real container. Not the cause of the empty
  transcripts, but it should carry the true extension.
- **Do:** deploy the fix, then record → upload → transcribe → enrich on the
  same iPhone, three notes end to end. Then Android — untested in either
  direction so far.
- **Accept:** three notes end to end per device; `MediaRecorder` availability on
  iOS Safari recorded either way; if unavailable, the degradation path is the
  thing that gets verified instead.

### SB-013 · Measure ASR quality on the user's dialect · `todo` · M

- **Blocked on:** SB-012.
- **Do:** 20 utterances the user would actually speak; count word errors by hand.
- **Accept:** a WER number in `docs/00-verification.md`. If it is bad, open a
  task to evaluate Azure `ar-AE` — `ASRProvider` is one interface.

## M5 — Scheduling

### SB-001 · Schedule the sweep worker · `done` · M

> **Done, proven on a live timer (2026-08-06).** The migration
> (`20260801000800_sweep_schedule.sql`) creates a `pg_cron` job that POSTs to
> the deployed function via `pg_net`, reading both the function URL and the
> service-role key from Vault at call time — neither is a literal in the file,
> and the project ref is not hard-coded. With the two secrets set on the local
> stack, `sweep-worker` (`*/5 * * * *`) fired **on its own timer** and returned
> a note stranded in `enriching` to `queued` with no client open and nothing
> invoked by hand: `cron.job_run_details` runid 3 `succeeded` at 18:35:00 UTC,
> `net._http_response` `200 {"unstuck":1,...}`, note `updated_at` 18:35:00. The
> retry pass that follows still fails enrich/embed for want of vendor keys
> (`missing_configuration`), so only the *unstick* arm is proven end to end; the
> rest waits on SB-005/SB-007, and a hosted run waits on SB-016. Unscheduled and
> secrets removed afterward. Evidence: `docs/00-verification.md` "SB-001 · A
> note recovered by the schedule".

### SB-017 · Schedule the weekly digest · `done` · S

> **Done, proven live with a real vendor call (2026-08-07).** First proof
> attempt (same day, earlier) had both `digest-enqueue`/`digest-collect` fire
> on their own fast-forwarded timer and reach the real function, but this
> worktree had no working `ANTHROPIC_API_KEY` — `requireEnv` threw before
> either action ran, so `net._http_response` showed `500
> missing_configuration`. Root cause turned out not to be a missing key at
> all: the real key was in the main checkout's `supabase/functions/.env` the
> whole time, but that file is gitignored (correctly — it holds real
> secrets) and a `git worktree` only carries tracked files, so it was never
> copied into this worktree. Copied it over, `supabase stop && start` from
> this worktree to load it.
>
> With the real key in place, `digest-enqueue` was fast-forwarded again and
> fired on its own timer: `cron.job_run_details` `succeeded`,
> `net._http_response` **`200 {"enqueued":1,"batch_id":"msgbatch_01Y1n9WqfVPGuUwZ1h35Ksjp",...}"`**
> — a real Anthropic Message Batches submission built from the owner's own
> 10 real enriched notes from the past week, and a real row landed in
> `digest_batches` (`status: submitted`). This is the task's actual accept
> line, now met without a manual invocation. Restored to the real weekly
> cadence afterward. Evidence: `docs/00-verification.md` "SB-017".

- **Accept:** a digest row appears in `digest_batches` on schedule without a
  manual invocation. ✅

### SB-018 · Run the digest once, for real · `done` · M

> **Done (2026-08-07).** The unverified combination broke on the first real
> run, exactly as suspected: the model wrapped its JSON in a ` ```json `
> fence, `JSON.parse` threw, and the fallback caught fenced JSON as raw
> prose. Fixed (`digest/index.ts` now strips a fence before parsing),
> re-run for real, and a second batch parsed cleanly into the full
> `{headline, themes, open_loops, wins, suggestion}` shape from the owner's
> real 10 enriched notes. Verified in the actual client too — `Digest.tsx`
> pre-existed and was untested with real data until now; it rendered
> correctly under RTL with zero console errors, signed in as the real
> owner via local OTP. Evidence: `docs/00-verification.md` "SB-018",
> `docs/04-ai-pipeline.md` "Stage 6".

- **Accept:** one real weekly digest exists, generated from at least a week of
  real notes; the fallback path is exercised deliberately at least once. ✅

## M6 — Hardening

### SB-002 · Per-user rate limit · `done` · M

> **Done, proven both in Postgres and over real HTTP (2026-08-06).** The
> counter is `ai_jobs` itself — no new table. `public.rate_limit_hit()`
> (migration `20260806000100`) counts a user's rows for a stage in a trailing
> window; `_shared/rateLimit.ts` calls it before `runEnrichment`/
> `runTranscription` and throws `429 rate_limited` (with its own `ai_jobs`
> row) if the count is already at the limit (`60` calls / `15` minutes — sized
> to clear the client's own ~50-note offline-replay burst, SB-024). `verify.sql`
> proves the SQL boundary live (trips exactly at the Nth call, not before;
> per-stage, not per-user; ignores calls outside the window). Then driven for
> real: 61 sequential `POST /enrich` calls against a real note under a real
> minted local JWT — calls 1–60 reached the vendor path and failed on the
> missing key (`500 missing_configuration`), call 61 was rejected by the gate
> **before** reaching it (`429 rate_limited`). `ai_jobs` matched the HTTP
> responses exactly: 60 + 1. Not proven under concurrency — see
> `docs/00-verification.md` "SB-002" for the honest gap. Evidence:
> `docs/00-verification.md` "SB-002 · Per-user rate limit".

`/enrich` and `/transcribe` are unbounded. A runaway client loop is a runaway
vendor bill, and both endpoints call paid APIs.

- **Do:** a per-user counter (a Postgres table with a window is enough — do not
  add infrastructure for this) checked before the vendor call.
- **Accept:** the (N+1)th call inside the window returns 429 with a typed error
  and an `ai_jobs` row; the vendor is never called. Test proves it.

### SB-003 · Strict CSP · `done` · M

> **Done, proven against a real build and a real dev server (2026-08-06).**
> One policy, built once in `vite.config.ts` from `VITE_SUPABASE_URL` so the
> header and the meta tag baked into the shipped HTML can never drift apart:
> `default-src 'self'` with no `unsafe-inline`, no `unsafe-eval`, no wildcard
> — `script-src`, `style-src`, `img-src`, `font-src`, `worker-src` all
> `'self'`; `connect-src` adds only the Supabase origin; `object-src 'none'`;
> `base-uri`/`form-action 'self'`. Getting to zero `unsafe-inline` meant
> removing the app's only 4 inline `style={{...}}` props (moved to CSS
> classes, same computed values, checked live: `24px` etc.) — the alternative
> was carrying an exception for four lines of margin.
>
> **Proven, not just configured:** `npm run build` then `vite preview` served
> the header for real (`curl -I`, confirmed byte-for-byte); loaded in a
> browser, signed in for real — a genuine cross-origin `POST .../auth/v1/otp`
> to a *different* origin than the page succeeded under `connect-src`, no
> violation. Then the guard was proven the way `check-rtl.mjs` was: a
> deliberate violation. `fetch("https://example.com/")` from the page was
> blocked (`Failed to fetch`), and the `securitypolicyviolation` listener
> caught it: `{directive: "connect-src", blocked: "https://example.com/",
> disposition: "enforce"}` — enforced, not report-only.
>
> **Correction, 2026-08-07: the original "dev mode re-verified" claim was
> wrong.** `vite dev` was checked for HMR reconnecting and a clean console —
> not for whether a component ever actually rendered. It did not: the CSP
> header (plus a meta-tag plugin that, unnoticed, also ran during `vite dev`)
> blocked the inline Fast Refresh preamble `@vitejs/plugin-react` injects,
> so React never mounted, silently. Found live while building SB-028. Fixed
> by dropping CSP from `vite dev` entirely (`server.headers` removed, meta
> plugin scoped `apply: "build"`) — correct on reflection, since CSP protects
> the shipped app, not Vite's own dev tooling. `vite preview` and the built
> `dist/index.html`, the actual production-representative surfaces this
> task's proof rested on, were unaffected throughout. Re-verified for real on
> `vite dev` afterward — see SB-028's evidence, same session.
>
> **Honest gap:** `frame-ancestors` and `report-to` cannot live in a `<meta>`
> CSP (the spec has browsers ignore them there), so the *served header*
> carries `frame-ancestors 'self'` but the meta-tag fallback baked into the
> built HTML does not. Whatever host SB-016 deploys to must set both at the
> server layer. Violation reporting today is `console.error` client-side
> (`securitypolicyviolation` in `main.tsx`) — visible, not centralized; a
> `report-to` collector is future work once SB-019 gives it somewhere to land.
> Evidence: `docs/00-verification.md` "SB-003 · Strict CSP".

Load-bearing, not hardening: `supabase-js` keeps the session in `localStorage`,
so a single XSS is a full session compromise. See `docs/08-security.md`.

- **Accept:** a `Content-Security-Policy` with no `unsafe-inline` and no
  `unsafe-eval` is served, the app still works, and violations are reported.

### SB-010 · Pin `ALLOWED_ORIGIN` · `done` · S

> **Done (2026-08-06).** `preflight()` in `_shared/http.ts` now rejects an
> `OPTIONS` request with a foreign (or missing) `Origin` at `403` when
> `ALLOWED_ORIGIN` is configured, instead of answering every preflight with
> `204` regardless of who asked and leaving enforcement entirely to the
> calling browser honouring a mismatched CORS header. Unset (every local
> environment today) stays permissive, unchanged.
>
> **The first `deno test` in this project** (`_shared/http.test.ts`, 5 cases)
> proves it, and was proven the way `check-rtl.mjs` was: the old code was
> swapped back in and 3 of 5 tests failed correctly, then the fix restored and
> all 5 passed. Wired into CI (`deno test --allow-env`) alongside `deno
> check`. Also confirmed live against the real local Edge Runtime after a
> full `supabase stop && start`: an `OPTIONS` preflight with a foreign
> `Origin` still returns the unset-default `204`/`*`, matching the
> unconfigured-locally case the test suite covers. Evidence:
> `docs/00-verification.md` "SB-010 · Pin `ALLOWED_ORIGIN`".

Defaults to `*` today.

- **Accept:** a request with a foreign `Origin` is rejected by the preflight
  path in `_shared/http.ts`; a test covers it.

> **Correction, 2026-08-09 (found while wiring up SB-016 for real):**
> `json()`'s CORS header used a `CORS_HEADERS` constant frozen at module
> load, not `corsHeaders()` called fresh per request the way `preflight()`
> already did — so `ALLOWED_ORIGIN` could apply to preflight rejections
> without reliably applying to the `Access-Control-Allow-Origin` header on
> the actual response, depending on isolate warmth. Fixed: `json()` now
> calls `corsHeaders()` directly. See `docs/00-verification.md` "SB-016".

### SB-004 · `ai_jobs` retention · `done` · S

> **Done (2026-08-07).** `public.purge_old_ai_jobs(p_days default 90)`
> (migration `20260807000100`) deletes `ai_jobs` rows older than the window
> and returns the count removed; scheduled via `pg_cron` daily at 03:00 UTC,
> unconditionally — no Vault secrets needed, since this never leaves
> Postgres (unlike the sweep/digest schedules). Window recorded in
> `docs/02-database-schema.md` under a new **Retention** section. Proven live:
> `verify.sql` inserts a 120-day-old row and a 10-day-old row, calls the
> function, and asserts the old one is gone and the recent one survives —
> `ALL SCHEMA CHECKS PASSED`. Confirmed on the running local stack:
> `cron.job` shows `ai-jobs-retention` scheduled and active; the 57 real
> `ai_jobs` rows (oldest from 2026-08-02) were untouched, correctly, since
> none are near the 90-day window yet. Left scheduled — no reason to turn it
> off, unlike SB-001's sweep. Evidence: `docs/00-verification.md`.

Grows without limit; it takes a row per stage per note per attempt.

- **Accept:** rows older than a stated window are removed on a schedule, and the
  window is written in `docs/02-database-schema.md`.

### SB-009 · Enforce audio retention · `done` · M

> **Done, proven end to end with a real upload and a real delete
> (2026-08-07).** `public.notes_audio_expired()` (migration
> `20260807000200`) finds candidates per-user (`audio_retention_days` is not
> a global cutoff); `sweep` deletes the actual Storage object via the Storage
> API — not a raw SQL delete on `storage.objects`, which would only remove
> the metadata row and orphan the bytes — then clears `notes.audio_path`.
> Reuses the existing sweep schedule; no new cron/Vault wiring needed.
>
> **SQL boundary proven in `verify.sql`:** a note 40 days past a 30-day
> retention window is flagged, one from yesterday is not.
>
> **Then proven live, for real bytes:** uploaded an actual object to the
> `audio` bucket via the Storage API, attached it to a note backdated 40
> days, restarted the stack, and `POST /sweep` returned `audio_purged: 1`.
> Confirmed three ways: `storage.objects` row count for that path went to
> `0`; a direct `GET` on the deleted object returned `400` — the bytes are
> actually gone, not just the metadata; `notes.audio_path` is empty while
> `raw_text` and `status` are byte-for-byte unchanged. A second `sweep` call
> returned `audio_purged: 0` (idempotent). A control note created *today*
> with real audio was swept over twice and its object survived both times —
> the boundary holds on both sides. Test data removed afterward; the
> owner's 14 notes and his 2 real audio objects were never touched.
> Evidence: `docs/00-verification.md` "SB-009 · Enforce audio retention".

`profiles.audio_retention_days` exists and nothing reads it. Storing a user's
voice longer than promised is a privacy failure, not a cleanup task.

- **Accept:** an audio object older than the user's setting is deleted from
  Storage on a schedule, the note survives with its transcript, and a test
  covers the boundary.

### SB-014 · Export everything · `done` · M

> **Done, proven against real data (2026-08-07).** `GET /export`
> (`supabase/functions/export`) runs entirely under the caller's own client —
> no service role, no `user_id` filter to forget, RLS is the reason no other
> user's data is reachable. Returns every note (including archived, unlike
> the timeline) with `raw_text`, its enrichments, and its tags with labels.
> Format documented in `docs/03-api.md`.
>
> Called for real against the owner's live account: **200, 13 KB, all 14
> notes**, including 2 archived and 1 completed, `raw_text` and full
> enrichment/tag detail present and correctly shaped. Cross-user isolation
> proven fresh, not just inherited: a brand-new disposable test user got back
> `notes: []` — zero leakage of the owner's 14 notes — then, after capturing
> one real note of their own, got back exactly that one note with its
> enrichment and tag correctly joined. Evidence:
> `docs/00-verification.md` "SB-014/015".

- **Accept:** one call returns every note, enrichment, and tag for the caller in
  a documented format, under RLS, with no other user's data reachable.

### SB-015 · Delete everything · `done` · M

> **Done, proven with a full deletion cycle against real data across every
> table (2026-08-07).** `POST /delete-account` (`supabase/functions/delete-account`)
> requires `confirm_email` to match the caller's own authenticated email
> exactly — the endpoint *is* the confirmation step, since no settings UI
> exists yet to put one in front of it. One call, `auth.admin.deleteUser()`,
> cascades through every `references auth.users ... on delete cascade` table
> (already true before this task — `docs/08-security.md`); this task's own
> code is the Storage audio cleanup, which no Postgres FK reaches.
>
> **Full live cycle, a disposable test user, never the owner's account:**
> created via the Auth Admin API, given one real note plus a real
> enrichment, tag, tag label, embedding, `ai_jobs` row, and a real uploaded
> audio object. A wrong `confirm_email` was rejected (`400
> confirmation_mismatch`) and the account confirmed still present. The
> correct email deleted it (`200 {"deleted":true}`). Afterward, **all 10
> tables checked read exactly zero** — `notes`, `note_enrichments`,
> `note_tags`, `tags`, `tag_labels`, `note_embeddings`, `ai_jobs`,
> `profiles`, `auth.users`, and `storage.objects` — and a direct `GET` on
> the deleted audio object returned `400`: the bytes are gone, not just the
> catalog row. The real owner's 14 notes, 1 `auth.users` row, and 2 real
> audio objects were confirmed present and untouched throughout. Evidence:
> `docs/00-verification.md` "SB-014/015".

- **Accept:** account deletion removes notes, enrichments, embeddings, tags,
  `ai_jobs` rows, and Storage audio; verified by a query returning zero rows
  across every table. Irreversible — needs an explicit confirmation step.

### SB-016 · Deploy to a real Supabase project · `done` · M

> **Done (2026-08-09).** Migrations, all 8 Edge Functions, the real
> `ANTHROPIC_API_KEY` secret, `ALLOWED_ORIGIN` locked to the real PWA
> origin, and the sweep/digest/retention `pg_cron` schedules are all live
> on the hosted free-tier project (`hfjpotjbrrnghuqhxoux`) — all four cron
> jobs `active: true`. PWA deployed to Cloudflare Pages:
> **https://wamda-a8k.pages.dev**.
>
> Three real bugs found and fixed by actually running the deploy, not
> reading it: (1) the hosted project's default email provider refused the
> custom OTP template (`supabase config push` → `400`, free-tier
> restriction) — fixed by configuring Resend as custom SMTP; (2)
> enrichment failed instantly with `error_code: unknown` — reproduced
> locally against the real API and found `'claude-sonnet-5' does not
> support the fallbacks parameter` (400); `_shared/pipeline.ts` sent
> `betas`/`fallbacks` unconditionally, a pair Sonnet 5 doesn't support —
> removed both; (3) `_shared/http.ts`'s `json()` used a `CORS_HEADERS`
> constant frozen at module load instead of calling `corsHeaders()` fresh
> per request the way `preflight()` already did, which would have made
> `ALLOWED_ORIGIN` unreliable on actual responses — fixed, then redeployed
> all functions so every isolate reads the secret fresh.
>
> **Full accept line met, proven live with no localhost involved:** signed
> in for real at the production URL, captured a real note, reached
> `status: ready` with `model: claude-sonnet-5` on its own. Evidence:
> `docs/00-verification.md` "SB-016".

Everything so far is local only.

- **Accept:** migrations applied to a hosted project, functions deployed,
  secrets set, the PWA served over HTTPS, and one real note captured on it.

## From PR #3 — note actions and capture feedback

PR #3 fixed three real UX bugs (dead action chips, no save feedback, no
redirect). These are the follow-ups its approach created or exposed.

### SB-024 · Capture must not wait for the outbox to drain · `done` · S

> **Done.** Capture releases on the IndexedDB write; `sync()` runs unawaited
> behind it. Measured against the live local stack: **95 ms** from Save to the
> note on screen with **8 notes still queued**, where the drain itself ran at
> **6 640 ms per note**. Evidence: `docs/00-verification.md`, "Capture latency
> and note actions". Textarea uses `readOnly` now, not `disabled`.

PR #3 changed `saveText` to
`await sync()` before releasing the UI. `sync()` replays the *entire* outbox
sequentially — up to 50 notes — and each note is a capture POST plus an
`enrich` call that waits on a full Opus 5 round trip. After a week offline, the
next capture locks the textarea for minutes.

That inverts principle 1 (`docs/10-product-spec.md`) and the reasoning in
ADR-0001: capture latency is supposed to be storage latency, never network
latency. The durability guarantee — the local IndexedDB write — is already
complete before `sync()` is called, so the confirmation does not need it.

- **Start at:** `web/src/features/Capture.tsx` `saveText`, `web/src/data/api.ts` `sync`.
- **Do:** confirm and release the UI on the *local* write. Either fire `sync()`
  without awaiting (as before PR #3), or add a `syncOne(clientId)` that pushes
  only the note just captured and leaves the backlog to the background pass.
- **Accept:** with 30 notes queued and the network throttled to 3G, the
  textarea is usable again in **under 300 ms** after Save, and the note is
  still durable if the tab is killed immediately. Measured, not assumed.
- **Keep:** the "جارٍ الحفظ…" state and the disabled Save button — those are
  the part users asked for and they are correct.
- **Also:** `disabled` on the textarea blurs it and dismisses the mobile
  keyboard. Prefer `readOnly` + `aria-busy`, or nothing at all once the wait is
  sub-300 ms.

### SB-025 · Show unsynced notes in the timeline · `done` · S

> **Done.** Outbox rows render alongside server rows, deduped by `client_id`,
> and `sync()` fires a `sb:synced` event so a placeholder becomes its enriched
> card unprompted. Verified offline, then online, then across a full reload —
> one card, never two, no stale placeholders.


This is *why* PR #3 awaited sync: the notes tab reads only from the server, so
a just-captured note would not be there on arrival. Fixing it here removes the
reason to block capture, and fixes a bigger problem — **a user who is offline
sees an empty notes list even though their notes are safe on the device.**

- **Start at:** `web/src/features/Notes.tsx`, `web/src/data/outbox.ts` `pending()`.
- **Do:** merge outbox rows into the timeline, marked with the existing pending
  wording, rendered from local text with no enrichment.
- **Accept:** capture a note offline, open the notes tab, see it; reconnect and
  watch it become one enriched card, not two rows.

### SB-029 · Verify dismiss for real · `done` · S

> **Done**, by the owner on his own notes. `action_dismissed_at` was set on 6
> notes and the chips were gone after a reload; archive re-confirmed alongside
> it. What the test also produced is SB-033: it worked and he could not tell.

### SB-033 · An answered suggestion must show that it was answered · `done` · S

> **Done.** Accepting or dismissing now shows a resolved line (`تمّت` /
> `تم التجاهل`, with a check) plus an undo that clears `action_dismissed_at`
> (`restoreNoteAction`). Verified in a browser: click → resolved state appears →
> undo restores the two chips. The destination for *accepted* suggestions is
> still SB-027; this is the feedback half only.

The owner clicked تجاهل and reported *"ماحصل أي شي"*. The write had succeeded
every time. All that happens on screen is two small links disappearing —
no confirmation, no movement, nothing to undo. Archive only felt real because
the card left the list.

This is not cosmetic. The chips are the one place the user answers the AI, and
an action that gives no feedback teaches them the app ignores them — on the
screen where trust in the AI is either earned or lost.

- **Start at:** `web/src/features/Notes.tsx` `handleAccept` / `handleDismiss`.
- **Do:** give the card a visible resolved state. An undo window is worth
  considering, since the action is currently irreversible from the UI.
- **Accept:** a person who has never seen the app can tell, without being
  told, that their click did something.
- **Related:** SB-027 — for every suggestion except archive there is also
  nothing behind the button. Fixing the feedback without fixing the
  destination makes the app *look* like it filed something it did not.

### SB-023 · Column-scoped update grant on `notes` · `done` · S

> **Done.** Migration `20260804000200` revokes the blanket `update` and
> re-grants `(archived_at, action_dismissed_at, completed_at, updated_at)` —
> `updated_at` because `capture_note`'s SECURITY INVOKER upsert touches it as
> the caller. `verify.sql` asserts `update notes set status` is rejected
> (42501) while the owned columns still write. Archive / dismiss / complete all
> still work in the app.

Pre-existing, and PR #3 now leans on it: `grant select, insert, update, delete
on public.notes to authenticated` lets a client update **every** column of its
own notes. It can set `status = 'ready'` on a queued note, rewrite `raw_text`
after enrichment was paid for, or forge `client_created_at`.

RLS is the only authorization layer here (ADR-0003), so "the client can only
break its own data" is the *whole* threat model — but silently poisoning the
pipeline's inputs is still worth closing.

- **Do:** `grant update (archived_at, action_dismissed_at) on public.notes to
  authenticated` in a new migration; revoke the blanket update.
- **Accept:** an authenticated client updating `notes.status` is rejected; an
  assertion in `verify.sql` covers it; archive and dismiss still work.

### SB-026 · Surface a failed local write · `done` · S

> **Done** alongside SB-024, because the rewrite of `saveText` had to decide
> what its `catch` did. The text now stays in the textarea and an error is
> shown. Not independently tested with IndexedDB forced to fail — the test in
> the acceptance line below is still worth adding.


`capture()` throwing (IndexedDB quota, private mode) propagates out of
`saveText` as an unhandled rejection: the field clears, nothing is shown, and
the thought is gone. `sync()` swallows its own errors, so this is specifically
the local path.

- **Accept:** with IndexedDB writes forced to fail, the text stays in the
  textarea and an error appears. Test covers it.

### SB-027 · A destination for accepted suggestions · `agreed, blocked on the design` · L

**Decided by the owner: build the real thing — a tasks/calendar destination
inside the product. Sequenced after the new design lands, not before.**

Today, clicking **"أضفها كمهمة"** creates no task — it records
`action_dismissed_at`, exactly like "تجاهل". The label promises something the
system does not do, and trust in AI output is the product (principle 5:
degrade honestly). The owner hit this himself: he clicked, nothing happened
anywhere, and he was right.

- **Blocked on:** the Stitch redesign (SB-031). What a task *is* on screen —
  a separate tab, a state on the note, a list that empties — is a design
  question, and building the model first would freeze an answer the design has
  not given yet.
- **Do not do the cheap relabel** unless the design slips badly. Renaming the
  chip to "تمّت المعالجة" is honest, but it retires the product's most
  valuable promise (the AI files things *for* you) to avoid a week of work.

When it happens, the parts that are already known:

- `notes.action_dismissed_at` cannot distinguish "I acted on it" from "I
  ignored it". Accepting and dismissing need to become different recorded
  states — that distinction is also the only available signal for the >70%
  unedited-category metric in `docs/10-product-spec.md`.
- `note_enrichments.action_due_at` already holds a resolved timestamp, proven
  on real model output ("الخميس" → the correct Thursday in `Asia/Dubai`). A
  calendar view has its date source already.
- The `suggested_action` enum already carries `create_task` and
  `create_event`; a destination gives them meaning rather than needing new
  keys.
- **ADR-0004 stays intact.** Tasks are a *view over notes*, not a folder tree
  — a note becomes a task, it does not move into one. Anything that reads as
  hierarchy needs a superseding ADR first.
- Pairs with SB-033: feedback without a destination makes the app look like it
  filed something it did not.

### SB-028 · Queue archive/dismiss while offline · `done` · S

> **Done, proven with the backend genuinely unreachable, not simulated
> (2026-08-07).** `archiveNote`, `dismissNoteAction`, and `restoreNoteAction`
> now share one `writeNoteField()`: try the real write, and on any failure
> — offline or a network error while nominally online, `navigator.onLine` is
> not trustworthy here either (`Notes.tsx`'s own comment) — queue it in a new
> IndexedDB store (`noteActions`, keyed `noteId:field` so a later action on
> the same field simply overwrites an earlier queued one instead of racing
> it on replay) instead of throwing. The caller never sees a failure, so the
> existing optimistic UI update in `Notes.tsx` fires either way, unchanged —
> no UI code needed to move for this. `sync()` replays the queue first, on
> the same reconnect trigger every other mutation already uses.
>
> **Proven in a real browser against the real local stack:** stopped the
> `kong` container (a genuine connection failure, not a flag), clicked
> "تجاهل" on a real note — the card updated immediately to the resolved
> state, no error shown. Confirmed the write had **not** reached the server
> (`action_dismissed_at` still null in Postgres) and **had** been queued in
> IndexedDB with the exact field/value. Restarted `kong`, called `sync()`,
> and the queue drained (`pendingNoteActions()` → `[]`) with the server row
> now correctly set to the exact timestamp that was queued. Reloaded the
> page: durable, not an in-memory illusion — action chips gone, matching a
> note that was genuinely answered.
>
> **A real bug in SB-003 surfaced and was fixed while building this** — see
> the correction in that task's entry above and in `docs/00-verification.md`.
> Evidence: `docs/00-verification.md` "SB-028".

`archiveNote` and `dismissNoteAction` are direct PostgREST writes. Offline they
fail with an error message — honest, but every other mutation in this app is
local-first.

- **Accept:** archiving offline updates the card immediately and reaches the
  server on reconnect. Low priority: the failure today is visible, not silent.

### SB-032 · A note that syncs but fails enrichment disappears · `done` · S

> **Done.** The owner hit this on his own stack: two notes he added stalled at
> `queued` (enrich failed with `missing_configuration` — no API key) and were
> invisible. `functions/notes` now returns every non-archived note, not just
> `ready`; `NoteCard` renders a processing card, or a `statusFailed` one for a
> `failed` note. Verified: two stranded notes reappeared as "جارٍ التحليل…".

Found while verifying SB-025. `sync()` marks a note synced even when
enrichment failed (correctly — the note is durable on both sides). But the
timeline only returns `status = 'ready'`, and the note is no longer in the
outbox either, so **it is in neither list**. The user watches a note they just
captured vanish.

Two of these exist in the local database right now (`status = 'failed'`).

- **Start at:** `web/src/features/Notes.tsx`, `supabase/functions/notes` timeline filter.
- **Do:** either return non-`ready` notes to the timeline (`NoteCard` already
  has a `statusProcessing` branch that nothing currently reaches), or keep
  showing the local row until its server version appears. If the second,
  respect pagination: an old local row must not resurface as "processing" just
  because it fell off the first page.
- **Accept:** a note whose enrichment fails is still visible, labelled as
  processing or failed — never absent.
- **Pre-existing**, not caused by SB-025; but SB-025 makes it more visible,
  since the note is now on screen right up until it disappears.

### SB-030 · Revert the committed dev-server port · `done` · S

> **Done** by settling on one number rather than reverting. `main` carries
> 5174, so `docs/15-runbook.md` now says 5174 and names the file that decides
> it. One number, one place.


PR #3 changed `.claude/launch.json` from 5173 to 5174 because another checkout
held 5173 during testing. That file is committed deliberately — "it defines how
to run the dev server and is the same for everyone" (`.gitignore`) — so a
machine-local collision is now everyone's default, and it contradicts
`docs/15-runbook.md`.

- **Accept:** either back to 5173, or 5174 with the runbook and README updated
  to match. One number, one place.

## Cross-cutting

### SB-011 · Bundle the app fonts · `done` · S

> **Done**, and the decision changed the face: the owner chose **Public Sans**
> (the redesign's Latin face). Since Public Sans carries no Arabic glyphs, it is
> paired with **Noto Sans Arabic**, split by `unicode-range`. Both are
> self-hosted variable woff2 in `web/public/fonts/` (~189 KB total), precached
> by the SW. The Amiri files were retired. Crucially, the Google Fonts `<link>`
> in `index.html` (IBM Plex over a CDN — an offline-first violation) was
> removed. Verified: both faces `loaded`, Arabic renders in Noto, no request to
> `fonts.gstatic`.

`global.css` names IBM Plex Sans Arabic / Noto Sans Arabic; neither ships, so
Arabic renders in a system fallback.

**Half of this is already sitting on disk, untracked:** `web/public/fonts/`
contains `amiri-400.woff2` and `amiri-700.woff2`. Nothing references them —
there is no `@font-face` anywhere — so they are inert bytes. Someone fetched
them and stopped. Amiri is a different choice from the two the CSS names, so
this needs a decision rather than a copy-paste.

- **Accept:** woff2 files committed, an `@font-face` block, correct
  `unicode-range`, and a recorded bundle-size delta. If the delta is
  unacceptable, record that decision instead of shipping the font.
- **Note:** hold until the redesign (SB-031) picks a typeface — shipping a font
  the design then replaces is wasted bytes twice.

### SB-019 · Queryable pipeline failures over `ai_jobs` · `done` · S

> **Done (2026-08-08).** `public.failed_ai_jobs` (migration
> `20260808000100_failed_ai_jobs_view.sql`) — one row per note+stage whose
> latest attempt is still failed, filterable by `note_id` or `stage`.
> Deliberately broken to prove the "latest attempt only" logic actually
> matters (a naive version showed a retried-then-succeeded stage as still
> failing; caught, restored, re-verified). Read against the owner's real
> `ai_jobs` data: 15 real currently-failing note+stage pairs surfaced
> correctly, all attributable to known blockers (missing vendor keys).
> Applied with `supabase migration up --local`, not `db reset`, to avoid
> wiping real data. Evidence: `docs/00-verification.md` "SB-019".

> **Scoped with the owner, 2026-08-08.** Narrowed from "structured logging and
> alerting" after checking what already exists: `ai_jobs`
> (`20260801000200_enums_and_tables.sql`) already carries `note_id`, `stage`,
> `status`, `error_code`, `latency_ms`, `cost_usd` on every enrich/transcribe/
> embed/digest attempt — the raw data this task wanted is already there.
> Decided:
> - **No alerting/push.** Queryable only — a view you check, not something
>   that pings you. No new send channel (email/Slack) for this pass.
> - **Views over `ai_jobs` only.** The scattered `console.log`/`console.error`
>   calls in the functions stay as free text; not worth restructuring them
>   for this pass. Accepted gap: a failure before an `ai_jobs` row is written
>   (e.g. `unhandled_error` in `_shared/http.ts`) is not covered — still only
>   visible in raw Docker/function logs.

- **Do:** a migration adding one or two views/functions over `ai_jobs` —
  e.g. `failed_ai_jobs` (latest failed attempt per note+stage, with
  `error_code`) and something queryable by a single `note_id`.
- **Accept:** `select * from failed_ai_jobs` (or equivalent) surfaces every
  note currently stuck on a failed stage with its error code, no ad hoc SQL
  needed beyond that one query. Assertion in `verify.sql`.

### SB-020 · Instrument the success metrics · `done` · M

> **Done (2026-08-08).** `stuck_notes`, `note_cost`/`cost_summary`, and
> `capture_latency_stats` (migration `20260808000200_success_metrics.sql`) —
> deliberately broken and caught once (`stuck_notes` missing its
> `archived_at` exclusion), then verified end to end in a real browser:
> signed in as the owner, captured a real note, watched
> `capture_latency_ms = 73` land in Postgres and `capture_latency_stats` pick
> it up. Read against real data: **2 real notes stuck 38.6 hours**
> (product-spec target is 0), average enrichment cost **$0.018827** across 11
> real notes (above the $0.015 target). Found and fixed a real
> `create or replace function` bug along the way — adding a parameter without
> dropping the old signature first left two ambiguous overloads. Evidence:
> `docs/00-verification.md` "SB-020".

> **Scoped with the owner, 2026-08-08.** Narrowed after checking
> `docs/10-product-spec.md`'s three named metrics against what exists:
> - **Stuck-note count** and **cost per note** are near-free — `notes.status`
>   + `updated_at` and `ai_jobs.cost_usd` already hold what's needed; this is
>   just views, same shape as SB-019.
> - **Capture latency (open → durable)** has zero instrumentation today —
>   it's the metric with the tightest target (p95 < 3 s) and was previously
>   only ever spot-measured by hand (SB-024: "95 ms with 8 queued", not
>   persisted). **Owner chose to include it**, not defer it.
> - **Surface: SQL views, opened manually in Supabase Studio.** No new page
>   in `web/`, no folding into the digest — smallest surface that still
>   answers "visible without running SQL by hand" (Studio's table view reads
>   a view without anyone typing a query).

- **Do:**
  - `capture_latency_ms` — add a nullable column to `notes` (client already
    knows this number per `Capture.tsx`/SB-024's measurement point) sent
    once, in the same payload the client already POSTs on sync. No new
    table, no new network round trip.
  - Views: `capture_latency_p95` (rolling window), `stuck_notes` (status not
    terminal, `updated_at` older than the sweep's own stuck threshold —
    reuse `sweep/index.ts`'s existing cutoff logic rather than inventing a
    second one), `cost_per_note` (sum of `ai_jobs.cost_usd` grouped by
    `note_id`, and an overall average).
- **Accept:** all three numbers readable from Supabase Studio's table/view
  browser with no query typed; each view's boundary case covered in
  `verify.sql` the same way SB-004/SB-009 covered their retention windows.

### SB-021 · Audit the note detail view · `done` · S

> **Done** by building it, then verifying. The note detail view now exists
> (`features/NoteDetail.tsx`) and shows `raw_text` beside the AI summary; opened
> from both a note card and a task row. Folded into SB-037. Inventory 4.13
> updated.

`docs/11-features.md` 4.13 claims raw text is shown next to the AI version;
this was inferred, not observed.

- **Accept:** either the claim is verified in a browser, or the feature is built
  and then verified. Update the inventory either way.

### SB-031 · Implement the new UI design · `done` · L

> **Done.** Theme (SB-031a) plus every behavioural surface: Tasks (SB-036), note
> detail + in-place save (SB-037/021), completion (SB-038/023), answered-
> suggestion feedback (SB-033), and the fonts (SB-011). The one redesign-adjacent
> item still open is **SB-032** (a note that fails enrichment is invisible) and
> the accepted-suggestion *destination* **SB-027** — neither is a theming or
> layout task. Evidence across `00-verification.md` "Design surfaces".

**The design landed** on 2026-08-03: three screens exported from Google Stitch,
committed under `docs/design/`. `docs/design/README.md` is the contract — read
it before touching any of the sub-tasks below.

**The governing decision: theme only.** Colours, type scale, spacing, radii.
Where the export contradicts behaviour that is already built and tested, the
built behaviour wins. That decision closed several questions outright:

| Question | Answer |
|---|---|
| Capture screen shape | **Unchanged.** The export replaces the autofocused textarea with a button, costing one tap per capture. Rejected — see the constraint below |
| Save confirmation | Stay in place; drop the `setTab("notes")` hand-off. Folded into SB-037 |
| Suggested-action buttons | **Stay.** The export has no accept/dismiss on its note cards; adopting that would delete a working feature. It also means the design offers **no resolved state** to copy for SB-033 — that still needs designing |
| Floating action button | Dropped — not needed |
| Day-grouped notes list | Not adopted. The flat keyset-paginated timeline stays |

The constraints this predicted all held, and the export violated three of the
four — every one caught before it reached `web/`:

- **Logical CSS properties only.** The export ships `right-4`, `pr-12 pl-4`,
  `left-6`, `left-8`, and `rtl:flex-row-reverse` (which double-reverses an
  already-mirrored flex row — visible in its own `screen.png`, brand on the
  wrong side). None ported.
- **Arabic text only in `web/src/i18n/`.** Five literals in the markup. The
  existing catalogue wording is better Arabic and stays (`جارٍ التسجيل…` over
  the export's `جاري التسجيل...`).
- **Capture stays the fastest path.** Held — see the table above.
- **Four plural forms and RTL mirroring.** Not yet re-checked against the new
  screens; carries into SB-036.

#### SB-031a · Port the theme · `done` · M

Tokens into `global.css`, PWA theme colours updated. Verified in a browser in
both colour schemes. Evidence: `00-verification.md`, "Theme port".

#### SB-036 · Tasks screen · `done` · M

> **Done.** `web/src/features/Tasks.tsx` — a filter over `category = 'task'`
> notes, grouped by `action_due_at` (overdue folds into today), priority rails,
> `taskCount` plural per group. Driven in a browser on the owner's real data:
> `3 مهام` → `مهمتان` → `مهمة واحدة` (few/two/one), and the rail mirrors under
> `dir=ltr`. Evidence: `00-verification.md` "Design surfaces".

A **filter over notes**, not a container — ADR-0004. Grouped اليوم / هذا الأسبوع
/ لاحقاً.

- **No migration needed for the grouping.** `note_enrichments.action_due_at`
  already exists, is a required field in the enrichment schema
  (`_shared/enrichment.ts`), is populated by the model, and is already selected
  by the timeline. This was mis-scoped as needing a new column; it does not.
- Priority rail on each card: `urgent` → `--danger`, `high` → the design's
  `secondary` `#56642b`, `low` → `--border`, **`normal` → no rail at all**.
- Group headings go in `i18n/`. Note the collision: `priorityLow` is already
  `لاحقًا`. One of the two must be reworded.
- Counts need `arPlurals` entries — it currently has exactly one (`pendingSync`).
- **Accept:** the four plural categories render correctly on real counts, and
  the screen mirrors under `dir=ltr`.

#### SB-037 · Open the source note from a task row · `done` · M

> **Done.** `web/src/features/NoteDetail.tsx`, opened from a task row and from a
> note card (folds in SB-021). Single-row `select raw_text` under RLS, no Edge
> Function. Verified: opening a task showed the captured text
> `عايز اركز علي المشروع بتاعي بكره` beside the AI summary.
>
> **The capture hand-off was NOT dropped.** It was, briefly, for an in-place
> `تم الحفظ` — but the owner tested it and read the missing redirect as failure.
> Reverted: capture hands off to the notes tab again, where the just-captured
> note now sits at the top (visible even while it enriches, thanks to SB-032).
> The list showing the note is the strongest confirmation there is.

Tapping a task shows the original note: the exact text captured, its date, its
summary. This is what keeps a task a *view*.

- **The timeline does not return `raw_text`, deliberately** — see the comment in
  `functions/notes/index.ts`; it is the difference between a 30 KB and a 900 KB
  response on a long scroll. A single-note fetch is needed. No Edge Function:
  `notes` is client-readable under RLS, so `select raw_text where id = ?` is
  enough.
- Overlaps SB-021, which asked for the same view from the notes list. Do them
  as one thing.
- Fold in the capture hand-off change from the table above: drop
  `setTab("notes")` in `App.tsx` and confirm the save in place instead. The
  design gives no confirmation state, so this needs designing, not copying —
  and the current hand-off is a *strong* confirmation. Do not remove it without
  a replacement that is as convincing.

#### SB-038 · `completed_at`, so a task can be ticked · `done` · M

> **Done** with SB-023, as planned. Migration `20260804000100` adds
> `completed_at`; `20260804000200` scopes the update grant to include it.
> `verify.sql` asserts both. Ticking writes optimistically and **survives a
> reload** — the Edge Function timeline now returns `completed_at`.

The checkbox has nothing to write to. `notes` has no completion column, and
`archived_at` is not it — that means "gone from the timeline and search for
good".

- Migration + RLS + a `verify.sql` assertion, **in the same change**.
- Do it together with SB-023 (column-scoped update grant): both alter the same
  grant, and doing them apart means touching it twice.

#### The font: no new task — **SB-011 is unblocked**

SB-011 was deliberately held "until the redesign picks a typeface". It has, and
the answer is unhelpful: Plus Jakarta Sans, Inter, and JetBrains Mono, **none of
which carry Arabic glyphs**. `DESIGN.md` covers the gap in one vague sentence
about "system-standard humanist sans-serifs" and names nothing.

So the design specifies no typeface for the app's primary language, there is
nothing here that a later redesign would waste, and the hold can lift. Go and
finish SB-011 with the Amiri files already sitting in `web/public/fonts/`, or
record the decision not to.

### SB-034 · Decide the enrichment model: Opus 5 or Haiku 4.5 · `done` · M

> **Done (2026-08-07). Decision: stay on Opus 5, not Haiku 4.5.** Ran the
> real production prompt/schema through both models against the owner's
> 12 real text notes (all real notes with `raw_text`; the other 2 are
> voice notes with no transcript yet, blocked on SB-007). Measured, not
> estimated: `category` agreed 58.3%, `suggested_action` agreed only
> 25.0%, and Haiku classified three near-duplicate real notes (the same
> haircut-with-مالك event, captured three times) as `task`/`event`/`event`
> — disagreeing with *itself*, not just Opus, which called all three
> `task`. Relative-date **day** resolution was correct on both models for
> every note (6/6 "بكرة" notes) — no hard date bug either way — but Haiku
> defaulted to `00:00:00` where Opus inferred a real time from context.
> Cost was 4.26x cheaper for Haiku as measured (not the ~5x estimate) —
> and won't reach even that in practice for burst captures, since Haiku
> 4.5's prompt-cache minimum (4,096 tokens, verified against Anthropic's
> current docs) is nearly 8x Opus 5's (512 tokens), so this system prompt
> (~2,169 tokens) never caches on Haiku at all, while Opus 5 caches from
> the second call on. Full comparison table and methodology:
> `docs/04-ai-pipeline.md` "Model choice: Opus 5 vs Haiku 4.5 (SB-034)".
>
> **Revised, 2026-08-09 (owner): switched to Sonnet 5, not Haiku 4.5.** A
> follow-up comparison (same 12 real notes, all three models in one run)
> found Sonnet 5 tracked Opus 5 at 83.3% category/priority agreement —
> clearly closer than Haiku's 75.0%/58.3% — and stayed self-consistent on
> the haircut-retry test that broke Haiku (`task/task/task`, matching Opus
> exactly), at ~0.6x Opus's per-token cost, a structural saving since
> Sonnet's cache minimum (1,024 tokens) clears the system prompt the way
> Haiku's (4,096) doesn't. `ENRICHMENT_MODEL` is now `claude-sonnet-5`. Full
> data: `docs/04-ai-pipeline.md` "Adding Sonnet 5 to the comparison".

There is an abandoned branch, `archive/sweep-worker-haiku-variant` (commit
`40f0a14`, kept from a worktree that was about to be deleted), whose message
reads *"switch enrichment to Haiku 4.5"*. Someone tried this and it never
reached `main`, with no record of why.

The stake is the only recurring cost the product has: **$0.008–0.011 per note
measured on Opus 5**, and enrichment runs on every note ever captured. Haiku is
roughly an order of magnitude cheaper.

- **Do:** run the same 20 real Arabic notes through both models and compare
  category, priority, tags, and — the one most likely to break — relative date
  resolution ("الخميس" → the correct Thursday in the user's timezone).
- **Accept:** a table in `docs/04-ai-pipeline.md` with measured cost and
  measured disagreement rate per field, and a decision recorded either way.
- **Do not switch on price alone.** A wrong category is the failure mode that
  makes the user file things himself, which is the product failing.

### SB-035 · One end-to-end test · `todo` · M

`docs/14-testing.md` names this as the strategy's biggest gap and no task
existed for it. The capture → sync → enrich → search loop is verified only by
hand, and this session showed how expensive that is: a broken Edge Runtime
presented as five unrelated symptoms and took most of a session to identify.

- **Do:** drive a real browser against the local stack — capture offline,
  reconnect, assert the note reaches `ready`, assert it is findable.
- **Accept:** it fails when the Edge Runtime is down, and says so in one line.
- **Note:** this is the one place a browser-automation dependency is worth it;
  everything else here is deliberately dependency-light.

### SB-022 · Safari and Firefox · `todo` · S

Only Chromium has ever run this app.

- **Accept:** capture, sign-in, and RTL rendering checked on both; findings
  recorded.

## Done

| # | Task | Evidence |
|---|---|---|
| SB-000a | Schema, RLS, RPCs + 12-check harness | `00-verification.md` |
| SB-000b | Five Edge Functions, type-checked against real SDK typings | `00-verification.md` |
| SB-000c | React PWA: i18n, RTL, offline outbox | `00-verification.md` |
| SB-000d | Email OTP auth end to end | `00-verification.md` |
| SB-000e | Enrichment run for real on Claude Opus 5 | `00-verification.md` |
| SB-000f | Prompt caching measured | `00-verification.md` |
| SB-000g | Sweep worker (unstick · retry · backfill · retry cap) | `09-status-handoff.md` |
| SB-000h | Project docs: spec, features, roadmap, tasks, ADRs, CI, agents | this change |
| SB-024 | Capture releases on the local write — 95 ms with 8 queued | `00-verification.md` |
| SB-025 | Unsynced notes render in the timeline, deduped by `client_id` | `00-verification.md` |
| SB-026 | Failed local write keeps the text and says so | folded into SB-024 |
| SB-031a | Theme ported from the Stitch export, light + dark, verified in a browser | `00-verification.md` |
| SB-036 | Tasks screen — filter over notes, grouped by due date, plurals on real data | `00-verification.md` "Design surfaces" |
| SB-037 | Note detail from a task/note (raw text); capture confirms in place | `00-verification.md` "Design surfaces" |
| SB-038 | `completed_at` migration + tick-to-complete, persists across reload | `00-verification.md` |
| SB-023 | Column-scoped update grant; `status` update rejected | `verify.sql` PASS |
| SB-021 | Note detail view built and verified (folded into SB-037) | `00-verification.md` |
| SB-033 | Answered suggestion shows `تمّت / تم التجاهل` + undo | `00-verification.md` |
| SB-011 | Self-hosted Public Sans + Noto Sans Arabic; CDN font `<link>` removed | `00-verification.md` |
| SB-032 | Non-`ready` notes stay visible (processing/failed), never absent | owner-reported; `CHANGELOG` |
| SB-001 | `pg_cron` sweep fired on its own timer; stranded `enriching` note → `queued`, no client | `00-verification.md` "SB-001 · A note recovered by the schedule" |
| SB-002 | Rate gate proven in `verify.sql` and over real HTTP: 60 vendor attempts then a clean `429` on call 61 | `00-verification.md` "SB-002 · Per-user rate limit" |
| SB-003 | Strict CSP served real (curl-confirmed), real cross-origin auth call succeeds, deliberate violation blocked + reported | `00-verification.md` "SB-003 · Strict CSP" |
| SB-010 | Preflight rejects a foreign Origin; first `deno test` in the project, proven against a deliberate regression | `00-verification.md` "SB-010 · Pin `ALLOWED_ORIGIN`" |
| SB-004 | `purge_old_ai_jobs()` scheduled daily; `verify.sql` proves old rows go, recent ones stay | `00-verification.md` "SB-004 · `ai_jobs` retention" |
| SB-009 | Real audio object uploaded and deleted via the Storage API; `400` on re-fetch proves the bytes are gone, not just the row | `00-verification.md` "SB-009 · Enforce audio retention" |
| SB-014 | `/export` proven against the owner's real 14 notes; cross-user isolation proven fresh with a disposable user | `00-verification.md` "SB-014/015" |
| SB-015 | Full deletion cycle on a disposable user: 10 tables to zero, real audio bytes confirmed gone, owner's account untouched | `00-verification.md` "SB-014/015" |
| SB-028 | Dismiss with the backend genuinely down: immediate UI update, queued in IndexedDB, replayed correctly on reconnect, durable across reload | `00-verification.md` "SB-028" |
| SB-017 | `digest-enqueue` fired on its own timer, real Anthropic Batch submission, real row in `digest_batches` | `00-verification.md` "SB-017" |
| SB-018 | Real digest generated from real notes; found + fixed a JSON-fence parsing bug; verified rendering in the client under RLS | `00-verification.md` "SB-018" |
| SB-019 | `failed_ai_jobs` view; deliberately broken and caught before trusting it; 15 real currently-failing note+stage pairs surfaced from live data | `00-verification.md` "SB-019" |
| SB-020 | `stuck_notes`/`note_cost`/`capture_latency_stats`; verified in a real browser (73ms capture, landed in Postgres); real findings: 2 notes stuck 38.6h, avg enrich cost $0.0188 (above $0.015 target) | `00-verification.md` "SB-020" |
| SB-034 | Opus 5 vs Haiku 4.5 vs Sonnet 5 measured on 12 real notes; decision revised 2026-08-09: switched to Sonnet 5 (83.3% category/priority agreement, self-consistent, ~0.6x cost) | `04-ai-pipeline.md` "Model choice" / "Adding Sonnet 5" |
| SB-016 | Live on hosted Supabase + Cloudflare Pages; 3 real bugs found and fixed (OTP template, Sonnet 5 fallbacks param, frozen CORS header); real note captured end to end at https://wamda-a8k.pages.dev | `00-verification.md` "SB-016" |
| SB-039 | Pulse mark + list-shaped skeletons; caught live by delaying the timeline fetch. `role="status"`, mark `aria-hidden` | `00-verification.md` "The second design round" |
| SB-040 | `add_circle`/`description`/`check_circle` redrawn as inline SVG (CDN icon font is CSP-blocked); rounded active pill | same |
| SB-041 | One note per row at every width, 3-line clamp, scrolling filter bar over the real 7 categories; accept/dismiss kept | same |
| SB-042 | Avatar menu; Escape closes and returns focus; anchors to the avatar's trailing edge in both RTL and LTR | same |

---

## Adding a task

Next free id, then:

```markdown
### SB-0NN · Title · `todo` · S|M|L

One sentence on why this matters — the consequence, not the activity.

- **Start at:** path/to/file.ts
- **Accept:** something a different person can check.
```

If you cannot write the acceptance line, the task is not understood well enough
to start.
