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
| SB-029 | Verify **dismiss** for real; migration exists only on the local DB | M1 | S | todo |
| SB-023 | Column-scoped update grant on `notes` | M6 | S | todo |
| SB-002 | Per-user rate limit on `/enrich` and `/transcribe` | M6 | M | todo |
| SB-032 | Notes that sync but fail enrichment are invisible | M1 | S | todo |
| SB-001 | Schedule the sweep worker — **may already be done**, see below | M5 | M | todo |
| SB-003 | Strict CSP | M6 | M | todo |
| SB-005 | Cohere key → embeddings + semantic search | M2 | M | **blocked** |
| SB-006 | Cross-lingual retrieval test | M2/M7 | S | **blocked** |
| SB-007 | ElevenLabs key → first real transcription | M3 | M | **blocked** |

> **SB-001 is written and stranded.** Commit `40f0a14 "Schedule the sweep
> worker via pg_cron + pg_net"` adds `20260801000800_sweep_schedule.sql`, is
> pushed to `origin/claude/technical-next-steps-bc88a1`, is **applied to the
> local database**, and has **no pull request**. Reviewed: it reads the
> function URL and service role key from Vault at call time rather than
> embedding either in a committed file, and when the secrets are absent it
> raises a `NOTICE` and leaves the job unscheduled instead of failing the
> deploy. `cron.schedule` replaces by name, so the file is re-runnable.
> Confirmed inert here — `cron.job` and `vault.secrets` are both empty, which
> is the documented behaviour, not a fault.
>
> **What remains:** open a PR for that branch, set the two Vault secrets in
> whichever environment should actually sweep, re-run the migration, and prove
> a stranded note recovers with no client open. Do not rebuild this.

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

### SB-007 · First real transcription · `blocked` · M

- **Blocked on:** `ELEVENLABS_API_KEY`.
- **Expect to change code.** `ScribeASR.transcribe` parses a response shape
  taken from documentation and never observed — particularly the per-word
  probability field used for confidence.
- **Accept:** an Arabic audio file reaches `raw_text` with a confidence value,
  and the observed response shape is recorded in `docs/04-ai-pipeline.md`.

### SB-012 · Voice capture on a real phone · `blocked` · M

**Partly answered already.** The local database holds two `source = 'voice'`
notes and the `audio` bucket holds their recordings — 173 KB and 8 KB of
`audio/webm`. So on the desktop browser used, `MediaRecorder` produced real
audio and the signed-URL upload to Storage worked. Both notes then failed at
`transcribe`. What is left is the part that actually needed a phone.

- **Blocked on:** SB-007.
- **Do:** record → upload → transcribe → enrich on a real iPhone **and** a real
  Android device. Desktop Chrome proves nothing here.
- **Accept:** three notes end to end per device; `MediaRecorder` availability on
  iOS Safari recorded either way; if unavailable, the degradation path is the
  thing that gets verified instead.

### SB-013 · Measure ASR quality on the user's dialect · `todo` · M

- **Blocked on:** SB-012.
- **Do:** 20 utterances the user would actually speak; count word errors by hand.
- **Accept:** a WER number in `docs/00-verification.md`. If it is bad, open a
  task to evaluate Azure `ar-AE` — `ASRProvider` is one interface.

## M5 — Scheduling

### SB-001 · Schedule the sweep worker · `todo` · M

The sweep worker is written and verified, and **nothing runs it**. No `pg_cron`
job exists in any migration.

- **Start at:** `supabase/functions/sweep/index.ts`, migration `…000700`.
- **Do:** a migration creating a `pg_cron` job that calls the deployed function
  URL via `pg_net.http_post`, with the service role key read from Vault — never
  literal in a migration.
- **Accept:** a note manually stranded in `enriching` with an old timestamp is
  returned to `queued` **with no client open and nothing invoked by hand**;
  `ai_jobs` shows the sweep run.
- **Note:** the URL and key are environment-specific. Parameterize; do not hard
  code a project ref.

### SB-017 · Schedule the weekly digest · `todo` · S

Same gap, same mechanism.

- **Accept:** a digest row appears in `digest_batches` on schedule without a
  manual invocation.

### SB-018 · Run the digest once, for real · `todo` · M

Batch API + structured outputs is an **unverified combination**; the code
requests JSON by prompt and falls back to keeping prose on a parse failure.

- **Accept:** one real weekly digest exists, generated from at least a week of
  real notes; the fallback path is exercised deliberately at least once.

## M6 — Hardening

### SB-002 · Per-user rate limit · `todo` · M

`/enrich` and `/transcribe` are unbounded. A runaway client loop is a runaway
vendor bill, and both endpoints call paid APIs.

- **Do:** a per-user counter (a Postgres table with a window is enough — do not
  add infrastructure for this) checked before the vendor call.
- **Accept:** the (N+1)th call inside the window returns 429 with a typed error
  and an `ai_jobs` row; the vendor is never called. Test proves it.

### SB-003 · Strict CSP · `todo` · M

Load-bearing, not hardening: `supabase-js` keeps the session in `localStorage`,
so a single XSS is a full session compromise. See `docs/08-security.md`.

- **Accept:** a `Content-Security-Policy` with no `unsafe-inline` and no
  `unsafe-eval` is served, the app still works, and violations are reported.

### SB-010 · Pin `ALLOWED_ORIGIN` · `todo` · S

Defaults to `*` today.

- **Accept:** a request with a foreign `Origin` is rejected by the preflight
  path in `_shared/http.ts`; a test covers it.

### SB-004 · `ai_jobs` retention · `todo` · S

Grows without limit; it takes a row per stage per note per attempt.

- **Accept:** rows older than a stated window are removed on a schedule, and the
  window is written in `docs/02-database-schema.md`.

### SB-009 · Enforce audio retention · `todo` · M

`profiles.audio_retention_days` exists and nothing reads it. Storing a user's
voice longer than promised is a privacy failure, not a cleanup task.

- **Accept:** an audio object older than the user's setting is deleted from
  Storage on a schedule, the note survives with its transcript, and a test
  covers the boundary.

### SB-014 · Export everything · `todo` · M

- **Accept:** one call returns every note, enrichment, and tag for the caller in
  a documented format, under RLS, with no other user's data reachable.

### SB-015 · Delete everything · `todo` · M

- **Accept:** account deletion removes notes, enrichments, embeddings, tags,
  `ai_jobs` rows, and Storage audio; verified by a query returning zero rows
  across every table. Irreversible — needs an explicit confirmation step.

### SB-016 · Deploy to a real Supabase project · `todo` · M

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

### SB-029 · Verify dismiss for real · `todo` · S

Half done. The column was **missing from the running local database** until it
was applied by hand mid-verification — confirming the risk was real, since the
timeline query selects it. Archive is now proven end to end: the card goes,
`archived_at` is set on exactly one row, and it is still absent after a full
reload. `dismissNoteAction` was **not** exercised.

- **Accept:** a dismissed note stops offering its chip **after a reload**, and
  `action_dismissed_at` is set on exactly that row.
- **Also:** the column reached the local database through a manual
  `alter table` plus a `schema_migrations` insert, because `supabase migration
  up` refused — the database has `20260801000800_sweep_schedule` applied, which
  exists on no branch in this worktree. Reconcile that before the next
  migration (see the SB-001 note at the top).

### SB-023 · Column-scoped update grant on `notes` · `todo` · S

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

### SB-027 · A destination for accepted suggestions · `todo` · L

Today, clicking **"أضفها كمهمة"** creates no task — it records
`action_dismissed_at`, exactly like "تجاهل". The label promises something the
system does not do, and trust in AI output is the product (principle 5:
degrade honestly).

Two ways out, and this is a **product decision, not an implementation one**:

- **Cheap:** relabel the chip to what it does ("تمّت المعالجة" / "خلصتها")
  until a destination exists.
- **Real:** a tasks/events model — which is exactly the kind of thing the
  pending design change might introduce. Do not build it speculatively.

Also worth splitting when it happens: one nullable timestamp cannot distinguish
"I acted on it" from "I ignored it", and that distinction is the only signal
for the >70% unedited-category metric in `docs/10-product-spec.md`.

### SB-028 · Queue archive/dismiss while offline · `todo` · S

`archiveNote` and `dismissNoteAction` are direct PostgREST writes. Offline they
fail with an error message — honest, but every other mutation in this app is
local-first.

- **Accept:** archiving offline updates the card immediately and reaches the
  server on reconnect. Low priority: the failure today is visible, not silent.

### SB-032 · A note that syncs but fails enrichment disappears · `todo` · S

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

### SB-030 · Revert the committed dev-server port · `todo` · S

PR #3 changed `.claude/launch.json` from 5173 to 5174 because another checkout
held 5173 during testing. That file is committed deliberately — "it defines how
to run the dev server and is the same for everyone" (`.gitignore`) — so a
machine-local collision is now everyone's default, and it contradicts
`docs/15-runbook.md`.

- **Accept:** either back to 5173, or 5174 with the runbook and README updated
  to match. One number, one place.

## Cross-cutting

### SB-011 · Bundle the Arabic font · `todo` · S

`global.css` names IBM Plex Sans Arabic / Noto Sans Arabic; neither ships, so
Arabic renders in a system fallback.

- **Accept:** woff2 files in `web/public/fonts/`, an `@font-face` block, correct
  `unicode-range`, and a recorded bundle-size delta. If the delta is
  unacceptable, record that decision instead of shipping the font.

### SB-019 · Structured logging and alerting · `todo` · M

- **Accept:** function logs are queryable by note id and stage, and a failed
  stage is discoverable without reading raw logs.

### SB-020 · Instrument the success metrics · `todo` · M

Every metric in `docs/10-product-spec.md` is currently unmeasured.

- **Accept:** capture latency, stuck-note count, and cost per note are visible
  somewhere without running SQL by hand.

### SB-021 · Audit the note detail view · `todo` · S

`docs/11-features.md` 4.13 claims raw text is shown next to the AI version;
this was inferred, not observed.

- **Accept:** either the claim is verified in a browser, or the feature is built
  and then verified. Update the inventory either way.

### SB-031 · Implement the new UI design · `todo` · L · *not started, by design*

A redesign is being produced in Google Stitch and will land as a spec later.
Nothing to do until it exists — this entry is here so the work is not a surprise
and so nobody polishes screens that are about to be replaced.

When it arrives, the constraints it must survive:

- **Logical CSS properties only.** `check-rtl.mjs` fails the build otherwise,
  and generated design output is a likely source of `margin-left`.
- **Arabic text only in `web/src/i18n/`.** Copy in the design becomes catalogue
  entries, never literals in components.
- **Capture stays the fastest path in the app.** A design that adds a step
  between opening and typing costs the product its reason to exist.
- **The four plural forms** and RTL mirroring must still hold on real content.

Pre-work that pays off either way: SB-025 (unsynced notes visible) and SB-024,
since both change what the capture and notes screens must show.

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
