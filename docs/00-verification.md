# 0. What was actually verified

An honest ledger. Nothing below is inferred from reading the code — it either
ran on this machine or it did not.

## Backend — ran, passed

### Migrations apply to a real Postgres

`supabase db reset` — all six migrations apply clean against Supabase local
(Postgres + pgvector), no warnings beyond an idempotent `pgcrypto already
exists` notice.

### 14 schema checks against a live database

```
docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
```

```
PASS: alef-hamza, tatweel, harakat all fold
PASS: taa-marbuta folds to haa
PASS: slugify converges (احمد)
PASS: arabic tsvector = 'كبير':2 'مدرسه':1
PASS: profiles auto-provisioned on signup
PASS: capture_note is idempotent on client_id
PASS: cross-user reads blocked on notes, note_tags, note_embeddings
PASS: generated search_vector populated = 'مدرسه':1
PASS: lexical search matches across spelling variants (1 hit(s))
PASS: unenriched note is still findable (summary is null: t)
PASS: tag variants collapsed to a single tag
PASS: notes.completed_at exists
PASS: scoped grant blocks notes.status, allows completed_at
PASS: every public table has RLS enabled
ALL SCHEMA CHECKS PASSED
```

The two that matter most: **cross-user isolation** (user B authenticated,
querying user A's note id directly, gets zero rows — on `notes`, `note_tags`,
and `note_embeddings` independently), and **Arabic search across spelling
variants** (a note stored with a taa-marbuta ending is found by a query typed
with a haa ending).

### Edge Functions type-check

`deno check` over all shared modules and all five functions — exit 0.

More informative than it sounds: it validated the Anthropic call against the
**real installed SDK typings**. `output_config.format`,
`thinking: {type: "adaptive"}`, `betas: ["server-side-fallback-2026-07-01"]`,
and `fallbacks: "default"` are current API surface, not plausible guesses.

## Client — ran, passed

The client is a React PWA (`web/`). Unlike the Flutter version it replaced,
every layer of it is verifiable on this machine, and was.

### Typecheck, tests, guard, build

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `vitest run` | **22 tests passed** (2 files) |
| `node tool/check-rtl.mjs` | passed |
| `vite build` | 449 KB → **129 KB gzipped**; SW + manifest emitted |

**The RTL guard was tested against a deliberate violation**, not just observed
passing. A temporary file with `margin-left` and `text-align: left` made it
exit 1 and report both offences; removing the file returned it to exit 0. A
checker that has only ever passed is not known to work.

### Design surfaces — Tasks, note detail, feedback, fonts — driven in a browser

Against the live local stack, signed in as the owner (12 real notes, 4 of them
`category = 'task'`), driven with the browser tools and read back from the DOM /
`getComputedStyle` / `document.fonts` — not inferred.

| What | Observed |
|---|---|
| **Tasks grouping** | Four task notes grouped اليوم (3, incl. two overdue folded in) / لاحقًا (1, no date). |
| **Arabic plural counts** | Group count rendered `3 مهام` (few), then `مهمتان` (two) after one completion, then `مهمة واحدة` (one) — three CLDR categories on real data. |
| **Tick to complete** | Checkbox → optimistic done state (line-through, 0.65 opacity, sinks in group); `completed_at` written to the DB; **survives a full reload** (Edge Function now returns it). |
| **Note detail (SB-037/021)** | Tapping a task opened the source note showing `raw_text` — `عايز اركز علي المشروع بتاعي بكره` — beside the AI summary, fetched as a single RLS read. |
| **Answered-suggestion state (SB-033)** | تجاهل → visible `تم التجاهل` + undo; undo restored the two action chips (DB `action_dismissed_at` cleared). |
| **Capture confirms in place (SB-037)** | Save kept the app on the capture tab, cleared the textarea, and showed `تم الحفظ ✓`. No hand-off to notes. |
| **RTL ↔ LTR mirroring (SB-036)** | Priority rail resolved to the row's right edge under `dir=rtl`, left under `dir=ltr` — logical properties, no override. |
| **Dark mode** | Task rows, sheet, and text resolved to the dark tokens (`--surface` #18201a, `--text` #e3e6e1); detail sheet renders as a full-width bottom sheet at 375×812. |
| **Fonts self-hosted (SB-011)** | `document.fonts` lists only Public Sans + Noto Sans Arabic, both `loaded`; Arabic measurably renders in Noto (94px vs 144px mono). **No request to `fonts.gstatic`/`fonts.googleapis`** — the CDN `<link>` is gone. |
| **Stranded notes stay visible (SB-032)** | Owner-reported: two notes stalled at `queued` (enrich `missing_configuration`, no API key) were invisible. After the timeline stopped filtering to `ready`, both reappeared as "جارٍ التحليل…" processing cards, and saving now hands back to the notes tab showing the new note on top. |

The grant assertion is doubly covered: `verify.sql` proves an authenticated role
cannot `update notes set status`, and the app proves archive / dismiss /
complete still work through the narrowed grant.

### Theme port — ran, in a browser, in both colour schemes

The Stitch design's tokens replaced the previous palette in `global.css`
(SB-031a). Driven at 375×812 with the dev server running, read back from
`getComputedStyle` rather than judged from a screenshot:

| | Value on screen |
|---|---|
| `--bg` | `rgb(249, 250, 248)` — `#f9faf8` |
| `--accent` | `#1b3022` |
| Save button background | `rgb(27, 48, 34)` |
| Radius | `8px` (was 16px) |
| Capture textarea | `18px`, line-height `29.7px` = 18 × **1.65** |
| `text-align` / `direction` | `start` / `rtl` |
| `<meta name="theme-color">` | `#1b3022` |

`npm run verify` after the change: typecheck exit 0, RTL guard passed, **21/21
tests**, build clean.

**Two real bugs, found by running it rather than reading it:**

**1. A comment closed the stylesheet early.** The ported header comment
contained the path `docs/design/*` followed by `/DESIGN.md` — and `*/`
terminates a CSS comment. Everything after it became garbage declarations.
esbuild's minifier reported it as `Unexpected "\`"` and `Unterminated string
token`, which points at neither the cause nor the line that matters. Confirmed
fixed by the emitted bundle shrinking 7.09 KB → 6.75 KB.

**2. Dark mode made every filled button unreadable.** `.btn` carried
`color: #fff` as a literal. That was safe while `--accent` was a mid-green in
both schemes; the new dark palette sets `--accent` to `#b4cdb8`
(`inverse-primary`), so white-on-sage measured **1.70:1** — below the 3:1 floor
for any text at all. Same trap on `.btn.recording` and `.btn-icon.recording`,
where dark `--danger` is `#ffb4ab`.

Fixed with `--on-accent` / `--on-danger`, which flip with the scheme.
Re-measured **in the page, not on paper** — `getComputedStyle` on the live
button, luminance computed from the returned `rgb()` values:

```
mode: dark   fg: rgb(6, 27, 14)   bg: rgb(180, 205, 184)   ratio: 10.56
```

1.70 → **10.56**.

This is the second time a hardcoded colour has survived a palette change in
this file. There are now no colour literals left in `global.css` outside the
two `:root` blocks.

**Contrast of the ported palette**, measured, not taken from `DESIGN.md` — whose
own "minimum 7:1" claim is true of its tokens and false of its markup, because
the markup layers opacity on top (its chip labels land at 3.98, its inactive nav
at 3.19). The opacity was not ported.

| | Light | Dark |
|---|---|---|
| Body text on background | 16.40 | 14.76 |
| Muted text on card | 9.35 | 7.48 |
| Chip ink on chip fill | 10.91 | 10.65 |
| Filled button | 14.07 | 10.56 |

**Not verified:** only Chromium, and only at 375×812. The notes and tasks
screens in the export have not been built, so nothing here says the theme holds
on a screen dense with cards.

### Live browser verification

Dev server started, page driven directly:

- `<html lang="ar" dir="rtl">`, computed direction `rtl`
- UI renders Arabic: title, tabs (`اكتب` / `ملاحظاتي` / `البحث` / `مراجعة الأسبوع`),
  placeholder `ما الذي يدور في بالك؟`
- `text-align: start` resolves correctly

**Logical properties genuinely mirror.** A probe element with
`margin-inline-start: 40px` computed to:

| | `dir=rtl` | `dir=ltr` |
|---|---|---|
| `margin-right` | **40px** | 0px |
| `margin-left` | 0px | **40px** |

**Offline capture works end-to-end with no server running.** Arabic text typed
into the real textarea, real Save button clicked, then IndexedDB read directly:

```json
{ "storedCount": 1, "clientIdIsUuid": true, "source": "text",
  "language": "ar", "unsynced": true, "textareaCleared": true,
  "pendingIndicator": "ملاحظة واحدة بانتظار المزامنة" }
```

That is the durability invariant — the thing the whole product rests on —
demonstrated rather than asserted.

**All four Arabic plural forms render distinctly**, driven by real
`Intl.PluralRules` against real note counts:

| count | category | rendered |
|---|---|---|
| 1 | `one` | ملاحظة واحدة بانتظار المزامنة |
| 2 | `two` | ملاحظتان بانتظار المزامنة |
| 3 | `few` | 3 ملاحظات بانتظار المزامنة |
| 11 | `many` | 11 ملاحظة بانتظار المزامنة |

Test data was cleared and the dev server stopped afterwards.

### Auth, end to end against a real Supabase

The full sign-in loop was driven in the browser, with the code pulled from the
local mail catcher — no mocks anywhere in the chain:

1. A note captured **while signed out** → landed in the local outbox
2. Notes tab → showed the sign-in gate with its reason, not a generic error
3. Email entered → `signInWithOtp` → real email delivered to Mailpit
4. Email confirmed to use the **custom Arabic RTL template**, carrying a
   six-digit `{{ .Token }}`
5. Code (`846776`) typed into the real form → `verifyOtp` → session established
6. Header flipped to `تسجيل الخروج`; `sync()` fired on the session change
7. **Both** queued notes — including the pre-auth one — present in Postgres
   under `muhammad@example.test`, with the profile auto-provisioned by the
   signup trigger

The `attempts` counters incidentally proved the sync guard: the note captured
before the guard existed shows `attempts: 1` (a wasted 401), the one captured
after shows `attempts: 0`.

### A stranded-state bug this run exposed

The same run revealed that `enrich` set `status = 'enriching'` and then threw
on the missing `ANTHROPIC_API_KEY` **without ever resetting it**. Two notes were
left in a non-terminal state: invisible to the timeline (which filters
`status = 'ready'`), with nothing to retry them.

Not a missing-key artifact — any transient failure (network blip, 502, timeout)
would do the same in production.

Fixed and then re-verified by re-running the failing path:

| | before | after |
|---|---|---|
| note status | stuck `enriching` | back to `queued` (retryable) |
| telemetry | none | `ai_jobs`: `enrich / failed / missing_configuration` |

Refusals resolve to `failed` instead, since re-running the same note against
the same prompt would refuse again. The same class of bug was fixed in
`transcribe`'s audio-download path.

### The AI pipeline, run for real against Claude Opus 5

With a live `ANTHROPIC_API_KEY`, two Arabic notes were enriched end to end and
both reached `ready`. Actual model output:

| | note 1 | note 2 |
|---|---|---|
| input | لازم أراجع عرض السعر مع أحمد قبل اجتماع الخميس | فكرة: نضيف تصدير الملاحظات إلى ملف واحد |
| title | مراجعة عرض السعر مع أحمد | فكرة: تصدير الملاحظات إلى ملف واحد |
| category | `task` | `idea` |
| priority | `high` | `low` |
| action | `create_task` | `review_later` |
| due | **2026-08-06 05:00Z** | null |
| tags | عمل · عروض-أسعار · متابعة · اجتماعات | تطوير-المنتج · تصدير-البيانات · ملاحظات |

Three things this confirms that no amount of type-checking could:

- **Relative date resolution works.** "الخميس" became `2026-08-06 05:00Z` —
  the correct upcoming Thursday, at 09:00 in the user's `Asia/Dubai` timezone.
- **`slugify` folds real model output.** The tag stored as `عروض-أسعار` (hamza)
  slugged to `عروض-اسعار` (bare alef), so a later note spelling it either way
  converges on one tag instead of fragmenting the graph.
- **The enum/label split holds end to end.** The database holds `task` and
  `low`; the UI rendered مهمة and لاحقًا from the catalogue, with the date
  formatted by `Intl` as `1 أغسطس، 05:19 م`.

### Prompt caching, measured rather than estimated

| call | `input_tokens` | `cache_read_input_tokens` | cost |
|---|---|---|---|
| 1st (cache write) | 97 | **0** | — |
| 2nd | 97 | **2169** | $0.0083 |
| 3rd | 97 | **2169** | $0.0105 |

The system prompt is ~2.2K tokens and is served from cache on every call after
the first, at ~0.1× input price. `enrich` logs `prompt_cache_miss` when
`cache_read_input_tokens` is 0 — that warning appeared on call 1 and never
again, which is exactly the intended signal.

Measured cost lands at **~$0.008–0.011 per note**, against the ~$0.015 the
design estimated from published pricing. The estimate was conservative.

### Build output

`dist/manifest.webmanifest` carries `lang: "ar"`, `dir: "rtl"`, and the Arabic
app name as valid UTF-8 (code points confirmed: 1575, 1604, 1583, 1605… =
الدماغ). `dist/index.html` preserves `<html lang="ar" dir="rtl">`. Service
worker and Workbox runtime emitted, 7 precache entries.

### Capture latency and note actions, against the live local stack

Run against Supabase local with a working `ANTHROPIC_API_KEY` and no Cohere
key, signed in as `muhammad@example.test` through the real OTP flow. Driven in
a browser, measured rather than reasoned about.

**Capture no longer waits for the outbox.** With 20 backlog notes seeded into
IndexedDB and a real server accepting them:

| | measured |
|---|---|
| Save click → note visible on the notes screen | **95 ms** |
| Notes still queued at that moment | **8** |
| Outbox drain rate, same run | **6 640 ms per note** |

The drain figure is the one that matters: each note costs a capture round trip
plus a real Opus enrichment call. `await sync()` in the capture path — the
shape this run was checking — would have held the composer shut for roughly
**two minutes** on a 21-note backlog, on localhost, before the user could type
the next thought. It now releases on the IndexedDB write alone.

**Unsynced notes are visible.** `navigator.onLine` forced false, note captured,
notes tab opened: the note rendered from the outbox with "محفوظة على جهازك" and
its capture time, with no server round trip. Back online, it became a single
enriched card — title, Arabic summary, category فكرة, action راجعها لاحقًا — with
no duplicate row. After a full page reload: 23 cards, zero stale local
placeholders, so the client-id dedupe holds across a cold start.

**Archive works end to end.** `20260802000100_note_action_state.sql` was applied
to the running database first — the column was **missing** until this run, so
the timeline query PR #3 shipped would have failed against it. After applying:
clicking أرشفة removed the card, set `archived_at` on exactly one row, and the
note was **still absent after a reload** — the server filter, not just optimism.

**Embeddings failed 42 times in the same run, as designed.** `ai_jobs` shows
`enrich/succeeded 42` beside `embed/failed 42`, and all 42 notes still reached
`ready`. That is ADR-0007 holding under real conditions: the optional stage
degraded the note instead of failing it.

Not covered by this run: a throttled or lossy network (localhost only), voice
capture, and Safari. `dismissNoteAction` was not exercised — only archive.

### CI, on a real runner

The workflow ran for the first time on 2026-08-02 and **caught a real bug on
its first attempt**, which is the best argument for it existing.

| Job | Result |
|---|---|
| web — typecheck · RTL guard · 21 tests · build | pass, 25 s |
| functions — `deno check` | pass, 12 s (**failed first**, see below) |
| database — migrations + 12 schema assertions | pass, 3 m 19 s |

The database job applies every migration to a real Postgres on the runner and
runs `verify.sql` against it: all 12 assertions printed `PASS` and the run
ended with `ALL SCHEMA CHECKS PASSED`. That is the same evidence as the local
run, reproduced on a machine nobody had configured.

**What the first run caught.** `deno check` failed:

```
TS2322: Type 'number | null' is not assignable to type 'number | undefined'.
  cache_read_input_tokens: usage.cache_read_input_tokens,
  at supabase/functions/_shared/pipeline.ts:324
```

`npm:@anthropic-ai/sdk` was imported with **no version** — there was a `TODO`
on that line about pinning it. The runner resolved 0.115.0, where the usage
counters are nullable, so local and CI were type-checking against different
SDKs. Pinned to `0.115.0`, and `EnrichOutput.usage` widened to match the SDK —
the one declaration still claiming those fields were merely optional, while
`costUsd` and both `ai_jobs` writes already treated them as nullable.

**Two faults in the workflow itself**, also first-run finds: `version: latest`
for the Supabase CLI resolves through an unauthenticated GitHub API call and
was **rate-limited**; and the `if: always()` stop step then ran a CLI that was
never installed, reporting the same failure a second time as `command not
found`. CLI pinned to 2.109.1; stop step made tolerant.

**The sweep schedule's safe path is now proven on a machine that never had
secrets.** Running CI over #5 applied `20260801000800_sweep_schedule.sql` to a
fresh Postgres and logged:

```
NOTICE: sweep-worker cron job NOT scheduled: set the "sweep_function_url" and
"sweep_service_role_key" Vault secrets, then re-run this migration.
```

followed by `ALL SCHEMA CHECKS PASSED`. That is the design claim — absent
secrets degrade to a notice rather than failing the deploy — reproduced
somewhere nobody had configured, instead of only on the machine where it was
written. It proved the *safe* path only; it still proved nothing about
sweeping — see the next section, which closes that gap.

### SB-001 · A note recovered by the schedule, with no client open

**2026-08-06, local stack.** The thing every prior sweep note said had never
happened: a `pg_cron` job fired on its own timer, called the deployed function,
and returned a stranded note to `queued` — no browser open, nothing invoked by
hand.

Setup, on the running local stack (`project_id = Second_Brain`, kong on 54421):

1. Set the two environment secrets the migration reads from Vault — the URL
   pointed at kong from inside the db container,
   `http://host.docker.internal:54421/functions/v1/sweep`, and the local
   service-role key.
2. Re-ran the `do` block of `20260801000800_sweep_schedule.sql`. It took the
   *scheduled* branch this time (secrets present) and registered
   `sweep-worker`, `*/5 * * * *`, `active = t`.
3. Inserted one note stranded in `enriching` with `updated_at` 15 minutes old —
   past the function's 10-minute `STUCK_MINUTES` cutoff.
4. Waited. Did not call the function.

What the database recorded, entirely on the cron's own timer:

| evidence | value |
|---|---|
| `cron.job_run_details` runid 3 | `succeeded`, `start_time` **18:35:00.03 UTC** |
| `net._http_response` id 3 (that call) | `200`, body **`{"unstuck":1,"retried":0,"embedded":0}`** |
| the note | `enriching` → `queued`, `updated_at` **18:35:00.29 UTC** |

The `unstuck:1` and the status flip are the same event seen from two sides. The
tick at 18:30:00 (`unstuck:0`, before the note existed) rules out coincidence —
the note moved on the first tick *after* it was stranded, not before.

**What did NOT run, stated plainly.** The retry pass that runs right after the
unstick tried to enrich the two genuinely-stranded `queued` notes on this stack
and failed with `missing_configuration` — **this worktree has no vendor keys** —
so they returned to `queued` (not `failed`; a non-refusal error is transient by
`pipeline.ts` design), each with one more `ai_jobs` attempt logged. So the
*unstick* arm of the sweep is now proven end to end on a real timer; the
*enrich/embed* arms still fail for want of keys, exactly as everywhere else in
this ledger (SB-005/SB-007). And this is **local only** — nothing has swept on a
hosted project (SB-016).

**Left inert again afterward, on purpose.** A `*/5` job against a keyless stack
would drive those two real notes to the 5-attempt cap and mark them `failed`, so
`sweep-worker` was unscheduled and both secrets deleted once the proof landed —
`cron.job` and `vault.secrets` are empty again, the same "written and proven,
not left running" state the earlier `host.docker.internal` test settled on. The
mechanism is proven; turning it on for real is one `vault.create_secret` pair
plus a re-run of the migration, per `docs/09-status-handoff.md`.

### SB-002 · Per-user rate limit on `/enrich` and `/transcribe`

**2026-08-06, local stack.** `/enrich` and `/transcribe` were unbounded — a
runaway client loop was a runaway vendor bill. The gate is `ai_jobs` itself
(no new table): `public.rate_limit_hit(user_id, stage, limit, window_minutes)`
(migration `20260806000100_rate_limit.sql`) counts a user's `ai_jobs` rows for
a stage in the trailing window; `_shared/rateLimit.ts` calls it after note
ownership is verified and before the pipeline is reached, and throws
`HttpError(429, "rate_limited")` — with an `ai_jobs` row of its own — if the
count is already at the limit. `LIMIT = 60`, `WINDOW_MINUTES = 15`, sized so
the client's own sequential outbox replay (up to ~50 notes after a long
offline stretch, SB-024) clears it, while a genuine runaway loop still trips
it well short of real cost.

**SQL layer, live Postgres (`verify.sql`, re-runnable):**

| assertion | result |
|---|---|
| 2 of a 3-call limit | not tripped |
| 3rd of a 3-call limit | **trips** |
| a different stage, same user | **not** tripped (counters are per-stage) |
| 5 calls from 2 hours ago, 60-minute window | not tripped (outside-window calls don't count) |

**HTTP layer, real request path — not a mock.** No client in this worktree
carries a session (no `VITE_SUPABASE_URL`/anon key configured here), so a
local-dev JWT was minted by hand with the known local `JWT_SECRET`
(`supabase status`) for the real owner (`eng.mohammadabdo@gmail.com`) — the
standard way to drive a local GoTrue instance without a browser. Confirmed
first against `/auth/v1/user` that it resolved to the real account, then fired
**61 sequential `POST /functions/v1/enrich`** calls (`force: true`, so every
call skips the enrichment cache and reaches the gate) against one of the
owner's real notes, after clearing that user's `enrich`-stage `ai_jobs` rows
from the trailing window so the count started at exactly 0:

| calls | HTTP status | body |
|---|---|---|
| 1–60 | `500` × 60 | `{"error":{"code":"missing_configuration"}}` — this worktree has no `ANTHROPIC_API_KEY`, so the vendor path fails immediately, but it was **reached** (`missing_configuration` can only originate inside `runEnrichment`) |
| **61** | **`429`** | **`{"error":{"code":"rate_limited"}}`** — the gate rejected it **before** `runEnrichment` was ever called |

`ai_jobs` afterward showed exactly `60 × (enrich, failed, missing_configuration)`
+ `1 × (enrich, failed, rate_limited)` — the database and the HTTP responses
agree on the same boundary. The note's own status was untouched by the
burst: `queued` before and after, same as its steady state under SB-001's
retry pass. All 61 test rows were deleted afterward; `/transcribe` reuses the
identical gate (`enforceRateLimit(admin, user.id, "transcribe", noteId)`) and
the per-stage isolation is already proven above, so it was not re-burst live.

**What this does not prove:** a rate limit under real vendor latency and real
concurrency — every call here failed fast (`missing_configuration`, no
network round trip), and all 61 were sequential. Concurrent requests racing
the same count-then-insert window could both read "under limit" and both
proceed, over-admitting by a small amount; acceptable for a single-user
product's runaway-loop guard, not proven safe at higher concurrency
(`docs/14-testing.md`, "No load or concurrency testing").

### SB-003 · Strict CSP

**2026-08-06, local build and dev server.** `web/vite.config.ts` builds one
policy from `VITE_SUPABASE_URL` — `default-src 'self'`; `script-src`,
`style-src`, `img-src`, `font-src`, `worker-src` all `'self'`; `connect-src
'self' <supabase-origin>`; `object-src 'none'`; `base-uri`/`form-action
'self'`. No `unsafe-inline`, no `unsafe-eval`, no wildcard, anywhere.

**Getting to zero `unsafe-inline` required a real code change**, not just a
header: the app had exactly 4 inline `style={{...}}` props (`Auth.tsx`,
`Capture.tsx`), each rendering as a `style` attribute a strict `style-src`
blocks the same as inline `<script>`. Moved to CSS classes
(`.auth-fallback-hint`, `.capture-error`, `.capture-unsupported`,
`.capture-pending`) carrying the exact literal values they replaced —
confirmed live: `getComputedStyle(el).marginBlockStart === "24px"` for the
`.auth-fallback-hint` case, matching the original inline value exactly.

**Served for real, both places that matter:**

| where | how checked | result |
|---|---|---|
| `npm run build` → `vite preview --port 4173` | `curl -I http://localhost:4173/` | `Content-Security-Policy:` header present, byte-identical to the policy in code, **including `frame-ancestors 'self'`** |
| `vite dev` (port 5174, the daily inner loop) | same `curl -I` | same header present |
| built `dist/index.html` | read the file | `<meta http-equiv="Content-Security-Policy" content="...">` injected at `head-prepend`, same policy **minus `frame-ancestors`** (the spec has browsers silently ignore it in a `<meta>` tag — omitted on purpose rather than shipped as dead weight) |

**The app was actually used under the policy, not just loaded.** Against the
`vite preview` build: clicked "تسجيل الدخول", typed a real email, submitted —
a genuine cross-origin `POST http://127.0.0.1:54421/auth/v1/otp` (page served
from `:4173`, API on `:54421` — different origins) returned `200`, no CSP
violation. Confirms `connect-src` is scoped correctly, not just present.

**Then the guard was proven the way `check-rtl.mjs` was proven** — a
deliberate violation, per `docs/14-testing.md`'s own rule that an untested
guard is not a guard:

```js
fetch("https://example.com/") // -> "Failed to fetch" -- blocked
```

and the `securitypolicyviolation` listener added in `main.tsx` caught it in
the same breath:

```json
{ "directive": "connect-src", "blocked": "https://example.com/", "disposition": "enforce" }
```

`disposition: "enforce"` — not `"report"` — confirms this is a blocking
policy, not a report-only one that would have let the request through.

**Correction, 2026-08-07 — the original dev-mode claim above was wrong.**
What was actually checked at the time: HMR reconnected and no
`csp_violation` appeared in console. What was **not** checked: whether a
component ever rendered. It did not. Found only while building SB-028, when
`vite dev` on port 5174 served a page with `document.getElementById('root')`
permanently empty — no console error, no CSP violation logged, nothing to
explain it.

Root cause, found by manually importing modules one at a time until one
threw: `@vitejs/plugin-react` injects an **inline** `<script>` preamble into
the dev-served HTML for Fast Refresh
(`window.__vite_plugin_react_preamble_installed__ = true`, checked by every
Babel-instrumented component module before it runs). `script-src 'self'`
with no `unsafe-inline` blocks that inline script outright — silently, since
an inline-script CSP block does not always surface as a
`securitypolicyviolation` the way a blocked `connect-src` request reliably
does. Every component import then failed with `"@vitejs/plugin-react can't
detect preamble"`, main.tsx never reached `createRoot(...).render(...)`, and
the page rendered nothing. **Two** sources turned out to carry the header:
`server.headers` in `vite.config.ts`, and the `cspMetaPlugin`'s
`transformIndexHtml` hook — which runs during `vite dev` too, not only
`vite build`, since neither has its own `apply` filter by default.

Fixed by removing the header from `server.headers` entirely and adding
`apply: "build"` to the meta plugin, so dev mode carries no CSP at all.
Correct on reflection, not just a workaround: CSP protects the *shipped*
app; Vite's own dev-time tooling was never part of what ships. Re-verified
after the fix — real OTP sign-in, a real note with suggestion chips, full
interaction — on `vite dev`, port 5174 (see SB-028 below, same session).
`vite preview` and the built `dist/index.html` were unaffected throughout;
both were the actual production-representative surfaces this task's proof
rested on, and neither ever carried the bug.

**What this does not cover, stated honestly:** `frame-ancestors` and
`report-to` cannot live in a `<meta>` CSP at all — the served header carries
`frame-ancestors 'self'`, but the meta-tag fallback baked into the static
build does not, so a host that serves the built files with no server-side
header config (a plain static host) ships without clickjacking protection.
Whatever host SB-016 picks must set both at its own header layer. Violation
reporting today is `console.error` client-side only — visible in DevTools,
not centralized; a `report-to` collector is real future work, not attempted
here, once SB-019 (structured logging) gives it somewhere to land.

### SB-010 · Pin `ALLOWED_ORIGIN`

**2026-08-06.** Before: `ALLOWED_ORIGIN` only decorated the CORS header value
(`Deno.env.get("ALLOWED_ORIGIN") ?? "*"`) — every `OPTIONS` preflight still
got a `204` regardless of who asked, so the real gate was entirely "does the
calling browser honour a mismatched `Access-Control-Allow-Origin`". After:
`preflight()` in `_shared/http.ts` rejects a foreign-or-missing `Origin` with
`403` when `ALLOWED_ORIGIN` is configured, *before* any header naming the
real origin goes back. Unset (every environment right now) stays permissive.

**The first `deno test` in this project** (`supabase/functions/_shared/http.test.ts`,
5 cases, no framework import so `deno test` needs no network access):

| case | result |
|---|---|
| non-`OPTIONS` request | passed through untouched, regardless of `ALLOWED_ORIGIN` |
| `ALLOWED_ORIGIN` unset, any Origin | `204`, `Access-Control-Allow-Origin: *` (local-dev default, unchanged) |
| `ALLOWED_ORIGIN` set, matching Origin | `204` with the pinned origin echoed back |
| `ALLOWED_ORIGIN` set, foreign Origin | **`403`**, no CORS header at all |
| `ALLOWED_ORIGIN` set, missing Origin | **`403`**, same as foreign |

**Proven against a real regression**, the same discipline `check-rtl.mjs`
was held to: the pre-fix `preflight()` (module-level `CORS_HEADERS`, no
origin check) was swapped back into `http.ts` and the suite run again —
**3 of 5 tests failed correctly** (`expected 403, got 204`; `expected
"https://app.example.com", got "*"`) — then the fix restored and all 5
passed. An untested guard is not a guard; this one was tested failing first.

```
FAILED | 2 passed | 3 failed   -- against the OLD code
ok     | 5 passed | 0 failed   -- against the fix
```

Wired into CI: `deno test --allow-env supabase/functions/_shared/http.test.ts`
runs alongside `deno check` in the `functions` job.

**Also confirmed live**, not just unit-tested: full `supabase stop && start`
so the Edge Runtime picked up the change, then a real `OPTIONS` preflight
against the running `enrich` function with `Origin: https://evil.example` and
no `ALLOWED_ORIGIN` configured — `204`, `access-control-allow-origin: *`,
matching the unset-default case exactly. The 14 real notes and the rest of
the stack were unaffected by the restart. The `ALLOWED_ORIGIN`-configured
rejection path was not additionally re-proven against the live container —
setting it locally would have changed this worktree's CORS behavior for
every other browser session using it, so the unit-test proof (which exercises
the real `preflight()` function, not a mock) stands as evidence for that case.

### SB-004 · `ai_jobs` retention

**2026-08-07, local stack.** `ai_jobs` takes a row per stage per note per
attempt and had no retention policy. `public.purge_old_ai_jobs(p_days default
90)` (migration `20260807000100_ai_jobs_retention.sql`) deletes rows older
than the window and returns the count removed; `pg_cron` calls it daily at
03:00 UTC. No Vault secrets involved — unlike the sweep/digest schedules this
never leaves Postgres, so it schedules unconditionally rather than taking the
conditional "NOTICE and stay unscheduled" path SB-001 needed.

**Proven live**, via `verify.sql`: inserted one `ai_jobs` row 120 days old and
one 10 days old for the same test user, called `purge_old_ai_jobs(90)`,
asserted the old row was gone and the recent one survived. `ALL SCHEMA CHECKS
PASSED`.

**Confirmed on the actual running stack**, not just in the test script:

| check | result |
|---|---|
| `cron.job` | `ai-jobs-retention`, `0 3 * * *`, `active = t` |
| the owner's 14 real notes | untouched |
| the owner's 57 real `ai_jobs` rows | untouched — oldest is from 2026-08-02, nowhere near 90 days |

**Left scheduled**, unlike SB-001's sweep-worker: there is no failure mode
from leaving this running against real data (it only ever deletes rows past
the window, and nothing here is anywhere close to it), so there was no reason
to turn it off after proving it.

### SB-009 · Enforce audio retention

**2026-08-07, local stack, real bytes.** `profiles.audio_retention_days`
existed since the first migration and nothing had ever read it.
`public.notes_audio_expired()` (`20260807000200_audio_retention.sql`) finds
notes whose audio has outlived their own owner's setting — a per-user join,
since retention is not a single global cutoff. `sweep` now consumes it: for
each candidate, deletes the actual object from the `audio` bucket via the
**Storage API**, then clears `notes.audio_path`. Deliberately not a raw SQL
delete on `storage.objects` — that would remove only the metadata row and
orphan the bytes, the opposite of the privacy goal.

**SQL boundary, `verify.sql`:** a note backdated 40 days past a 30-day
retention window is flagged by `notes_audio_expired()`; one from yesterday is
not. `ALL SCHEMA CHECKS PASSED`.

**Then proven with a real upload and a real delete — not a mock:**

1. Uploaded a real object to the `audio` bucket via `POST
   /storage/v1/object/audio/<user_id>/<note_id>.webm` (Storage REST API,
   service role) — confirmed present in `storage.objects` first.
2. Attached it to a test note, `client_created_at` backdated 40 days.
3. Restarted the stack so the Edge Runtime ran the new code (the documented
   stale-code gotcha), then `POST /functions/v1/sweep` for real:
   `{"unstuck":0,"retried":0,"embedded":0,"audio_purged":1}`.

| check | result |
|---|---|
| `storage.objects` row for that path | `0` — gone |
| direct `GET` on the deleted object | **`400`** — the bytes themselves are gone, not just the catalog row |
| `notes.audio_path` | empty |
| `notes.raw_text`, `status` | byte-for-byte unchanged — the note survives with its transcript |
| second `sweep` call | `audio_purged: 0` — idempotent, nothing left to do |

**The other side of the boundary, also proven live, not assumed:** a second
test note captured *today* with a real uploaded audio object was swept over
twice (once alongside the expired note, once alone) and its object survived
both times — `storage.objects` count stayed `1`, `audio_path` stayed set.

Test notes and objects removed afterward. The owner's 14 real notes and his 2
real audio objects were confirmed present, untouched, before and after.

### SB-014/015 · Export everything · Delete everything

**2026-08-07, local stack, real data, a disposable user, never the owner's
account.**

**SB-014, against the real owner's account (read-only, safe):** a local-dev
JWT was minted for the real owner (no client session exists in this
worktree). `GET /export` returned `200`, 13 KB, exactly the owner's **14**
real notes, correctly split **2 archived / 1 completed / 10 with an
enrichment and tags** — matching known counts from earlier sessions.
`raw_text`, full enrichment detail (`title`, `summary`, `category`,
`priority`, `suggested_action`, `action_due_at`, `context`, `model`), and
tags with per-language labels were all present and correctly nested.

**Cross-user isolation for `/export`, proven fresh — not just inherited from
RLS being proven elsewhere.** A disposable test user was created via the
Auth Admin API (`sb015-disposable-test@example.test`). Before they had any
data: `GET /export` → `{"notes":[]}` — zero leakage of the owner's 14 notes.
They then captured one real note through `POST /notes`; `GET /export`
immediately returned exactly that one note.

**SB-015, full deletion cycle, the same disposable user:** given one real
enrichment, tag (+ label), embedding, `ai_jobs` row, and a real audio object
actually uploaded to the `audio` bucket via the Storage REST API. Pre-check
confirmed exactly 1 row in every relevant table.

| step | result |
|---|---|
| `POST /delete-account` with the wrong `confirm_email` | `400 confirmation_mismatch`; user still present afterward |
| `POST /delete-account` with the correct `confirm_email` | `200 {"deleted":true}` |

**Every one of 10 tables checked read exactly zero afterward:** `notes`,
`note_enrichments`, `note_tags`, `tags`, `tag_labels`, `note_embeddings`,
`ai_jobs`, `profiles`, `auth.users`, `storage.objects` — the last two
confirming the deletion reached the auth layer and Storage, not just
application tables. A direct `GET` on the deleted audio object returned
**`400`** — the same real-byte-deletion proof used for SB-009, not just an
absent catalog row.

**The real owner was never touched, confirmed before and after:** 14 notes,
1 `auth.users` row, 2 real audio objects, all present and unchanged.
`auth.users` held exactly 2 rows throughout the whole test — the owner and
the pre-existing documented local test fixture (`muhammad@example.test`,
CLAUDE.md) — never the disposable user once deletion completed.

**What this does not cover:** there is no settings/account screen in the
client yet, so `confirm_email` was exercised directly against the API, not
through a UI a person would actually click through. The endpoint's
confirmation gate is real regardless of whether a UI sits in front of it.

### SB-017 · Schedule the weekly digest

**2026-08-07, local stack.** Mirrors SB-001's proof exactly, on the `digest`
function's own two actions. Migration `20260807000300_digest_schedule.sql`
schedules `digest-enqueue` (Saturdays 03:00 UTC) and `digest-collect` (every
6 hours) via `pg_cron`, conditional on two Vault secrets, both read live at
call time — never baked into the stored job text (an earlier draft of this
migration did exactly that with `format(...)`, caught and fixed before it
was ever applied: the secret would have sat in cleartext in `cron.job`,
readable by anyone who could `select command from cron.job`).

With the secrets set, both jobs were temporarily fast-forwarded to `* * * *
*` to observe a real automatic tick within the session rather than waiting
until next Saturday:

| job | fired on its own timer | `net._http_response` |
|---|---|---|
| `digest-collect` | `succeeded`, 20:48:00 | `500 {"error":{"code":"missing_configuration"}}` |
| `digest-enqueue` | `succeeded`, 20:49:00 | `500 {"error":{"code":"missing_configuration"}}` |

Both reached the real `digest` function — the `500` is `requireEnv`
throwing on the missing `ANTHROPIC_API_KEY`, which this worktree does not
have, before either action's own logic runs. This is the mechanism working
correctly, not a failure of it: `cron.job_run_details` and the real HTTP
response together prove the schedule fires and reaches the function, exactly
as much as is provable without the vendor key.

Restored to the real cadence, then unscheduled and both secrets removed —
same reasoning as SB-001: nothing useful comes from leaving a keyless job to
fail on a timer forever in this environment. `cron.job` and `vault.secrets`
are clean of digest entries again; `ai-jobs-retention` (SB-004) is the only
job left scheduled, correctly, since it has no vendor dependency.

**Not proven, and this is the task's actual accept line:** a real row in
`digest_batches`. That needs a real `messages.batches.create()` call, which
needs the key. SB-017 is filed `blocked` on that basis, not `done` — the
mechanism working is necessary but not sufficient for what the task itself
asks for.

**Follow-up, same day: the key was never actually missing.** The real
`ANTHROPIC_API_KEY` was sitting in the *main* checkout's
`supabase/functions/.env` the whole time (used for the original SB-000e
enrichment proof on 2026-08-01) — but `.env` files are gitignored by design,
and `git worktree` only carries tracked files, so this worktree's checkout
never had a copy. Confirmed by checking key lengths without printing values:
`ANTHROPIC_API_KEY` was 108 characters in the main checkout, `COHERE_API_KEY`
and `ELEVENLABS_API_KEY` were 3 characters (genuine placeholders) in both.

Copied `supabase/functions/.env` from the main checkout into this worktree,
then `supabase stop && supabase start` **from this worktree** so the Edge
Runtime actually loaded it (a restart alone does not pick up a changed env
file, same trap as stale code). Proved the key works before touching the
schedule: minted a local JWT for `muhammad@example.test`, captured a real
note over HTTP, called `POST /enrich` — real `200`, real Claude Opus 5 usage
(`114` input / `428` output tokens, `$0.024826`), real enrichment fields
back. (The note's Arabic text arrived corrupted — a Git-Bash/Windows shell
UTF-8 quoting artifact from how the test payload was passed via `curl -d`,
confirmed by reading `raw_text` back from Postgres; not an app bug. The model
correctly flagged the corruption rather than guessing at content, which is
itself a reasonable proof of the degrade-honestly path. Test note deleted
afterward, real data untouched.)

With the key confirmed working, set the two Vault secrets again and
re-applied the migration. `digest-enqueue` was fast-forwarded to `* * * *
*`, and this time fired for real: `cron.job_run_details` `succeeded` at
2026-08-07 01:06:00 UTC, `net._http_response` **`200
{"enqueued":1,"batch_id":"msgbatch_01Y1n9WqfVPGuUwZ1h35Ksjp","period":{"start":"2026-07-31","end":"2026-08-07"}}`**
— one request, correctly: the owner has exactly one `(user_id, language)`
pair with activity in the window (10 real enriched notes, 2026-08-01 to
2026-08-03), and the function groups by that pair, not by note. A real row
landed in `digest_batches` (`status: submitted`, `request_count: 1`) — the
task's actual accept line, now met by the schedule firing on its own timer,
no manual invocation. Restored `digest-enqueue` to its real weekly cadence
(`0 3 * * 6`) afterward.

**SB-017 is now `done`.** `collect`-side proof (a real row in
`weekly_digests`, SB-018) is separate — the Batch API can take up to 24h, so
that half is tracked under SB-018, not here.

### SB-018 · Run the digest once, for real

**2026-08-07, same session as SB-017, continuous with it.** The first real
batch (`msgbatch_01Y1n9WqfVPGuUwZ1h35Ksjp`, SB-017's proof) finished quickly
and was collected: `POST /digest {"action":"collect"}` returned
`{"collected":1}`. But the stored `weekly_digests.content` was
`{"headline": "```json\n{\n  \"headline\": ...\n```"}` — the whole structured
response, fence and all, sitting inside the fallback's single field. Exactly
the risk the code's own comment named ("Batches + structured outputs is a
combination worth verifying"): the model wrapped valid JSON in a ` ```json `
markdown fence, `JSON.parse` threw on the backtick, and the catch block's
raw-text fallback caught it.

**This is a real bug, not an acceptable-and-documented gap** — the fallback
existing is good design, but shipping fenced JSON as the "headline" a user
reads is not something to leave in place. Fixed in
`supabase/functions/digest/index.ts`: strip a ` ```(json)? ... ``` ` fence
before `JSON.parse`, falling through to the old raw-text behavior only if
what's left still doesn't parse. `deno check` was not run — no working
`deno` binary was found on this machine (checked `PATH`, the edge runtime
container, and the Supabase-CLI-bundled cache dir) — so this change is only
proven by actually running it, per the project's own rule 1.

Reloaded the stack (`supabase stop && start`, from this worktree, so the new
function code was actually served — see the CSP incident earlier in this
file for why a bare restart isn't trusted here). Vault secrets and
`cron.job` rows survived the restart (backed by the same Postgres volume).
Fast-forwarded `digest-enqueue` again for a **second** real batch
(duplicate submissions for the same period are fine — `weekly_digests`
upserts on `(user_id, period_start, language)`, so the fixed run overwrites
the malformed one). Fired on schedule, `net._http_response` `200
{"enqueued":1,"batch_id":"msgbatch_...","period":{"start":"2026-07-31","end":"2026-08-07"}}`.
Polled `collect` every 30s until it returned `{"collected":1}`
(2026-08-07 ~01:2x UTC). Restored `digest-enqueue` to `0 3 * * 6` afterward.

**Result: clean, correctly-shaped JSON** —
`{headline, themes: [{title, detail}], open_loops: [], wins: [], suggestion}`,
all fields populated, real Arabic prose, built from the owner's real 10
enriched notes from the past week (`eng.mohammadabdo@gmail.com`,
2026-08-01 to 2026-08-03). Verified `jsonb_pretty(content)` directly in
Postgres — no code-fence residue, no truncation.

**Then verified in the actual client, not just the database** — the first
time this screen has ever had real content to render. `web/src/features/Digest.tsx`
already existed, unchanged, reading straight from `weekly_digests` under RLS
(no Edge Function). Started the dev server, signed in as the real owner via
local OTP (Mailpit), opened "مراجعة الأسبوع": the full digest rendered —
headline, all 4 themes with title+detail, both wins, all 3 open loops, the
one suggestion — correct RTL layout, zero console errors. Before signing in
as the owner, the same tab correctly showed the empty state
(`"ستظهر مراجعتك الأسبوعية هنا يوم السبت"`) while signed in as the local test
user `muhammad@example.test`, who has zero notes — confirming the empty
state and the populated state are both reachable and RLS-correct, not a
fluke of one account.

**Fallback path exercised deliberately, per this task's own accept
criterion** — the first run's fence-wrapped failure *was* the fallback
firing for real, before the fix. Both halves of SB-018's accept line are now
met: a real weekly digest exists from real notes, and the fallback path was
exercised (once, by accident, which is what surfaced the bug worth fixing).

**SB-018 is now `done`.**

### SB-034 · Decide the enrichment model: Opus 5 or Haiku 4.5

**2026-08-07, local stack, real key.** An abandoned branch
(`archive/sweep-worker-haiku-variant`) had already swapped
`ENRICHMENT_MODEL` to Haiku 4.5 for the ~5x cost estimate but never had
output quality checked, and never merged. This task ran the real
production prompt (`_shared/enrichment.ts`, copied verbatim into a
standalone script) and schema through both models, in parallel, against
the owner's 12 real text notes (`eng.mohammadabdo@gmail.com`; the other 2
of the 14 total notes are voice notes with no `raw_text` yet, out of
scope — blocked on SB-007). Real API calls, real cost, no synthetic data:
24 calls total, `$0.1747` combined.

Request shapes matched each model's real constraints, not a naive
"swap the model string": Opus 5 kept `thinking: adaptive`,
`output_config.effort`, and the refusal-fallback beta; Haiku 4.5 dropped
all three (confirmed via the abandoned branch's own commit message that
Haiku 4.5 rejects them with `400`). Structured output
(`output_config.format`, JSON schema) worked on both.

| Field | Agreement (12 notes) |
|---|---|
| `category` | 7/12 = 58.3% |
| `priority` | 10/12 = 83.3% |
| `suggested_action` | 3/12 = 25.0% |
| relative-date day correct | 12/12 = 100%, both models |

**The specific risk the task named — a wrong category — showed up as
self-inconsistency, which is worse than simple disagreement with Opus.**
Three notes are real retries of the same real event (a haircut with
مالك, worded slightly differently each capture: `08041e8e`, `cd4e6e6d`,
`a6887370`). Opus classified all three `task`. Haiku classified them
`task`, `event`, `event` — flip-flopping on near-identical input from the
*same model*, not just diverging from Opus's judgment.

**Date-day resolution held on both models for all 6 notes containing "بكرة"**
— no hard date bug on either side, contrary to what the task brief
worried about. What differed was the *time* component: Opus consistently
inferred a contextually plausible time (matching an explicitly stated
"12 الظهر" correctly, and picking sensible defaults — 9am, noon, evening —
where none was stated); Haiku defaulted to `00:00:00` in most of those
cases, a placeholder rather than an inference.

**Cost, measured over the same 12-note run:**

| | Opus 5 | Haiku 4.5 |
|---|---|---|
| Avg cost/note | $0.01179 | $0.00277 |
| Avg latency | 7026 ms | 3922 ms |
| Cache engaged | Yes, from call 2 on | **No — 0/12 calls, any call** |

**Secondary finding, verified against Anthropic's current docs
(`platform.claude.com/docs/en/build-with-claude/prompt-caching`), not
assumed:** minimum cacheable prompt length is 512 tokens for Opus 5 but
4,096 tokens for Haiku 4.5. The system prompt (~2,169 tokens) clears
Opus 5's bar and misses Haiku's — every one of Haiku's 12 calls showed
`cache_creation_input_tokens: 0` and `cache_read_input_tokens: 0`, while
Opus 5 wrote the cache on its first call and read it on the other 11.
Measured cost ratio: **4.26x**, not the ~5x the task's own estimate
assumed — and the real-world gap narrows further for a user who captures
notes in bursts, since only Opus 5 benefits from that pattern at this
prompt length.

**Decision: stay on `claude-opus-5`.** Per the task's own instruction —
"do not switch on price alone; a wrong category is the failure mode that
makes the user file things himself, which is the product failing" — a 75%
disagreement rate on `suggested_action` plus demonstrated
self-inconsistency on a real repeated event is that failure mode, measured,
not a marginal quality gap. `ENRICHMENT_MODEL` unchanged. Full table and
reasoning: `docs/04-ai-pipeline.md` "Model choice: Opus 5 vs Haiku 4.5
(SB-034)".

**2026-08-09, Sonnet 5 added to the comparison, same real stack, real key.**
Re-ran all three models (Opus 5, Sonnet 5, Haiku 4.5) fresh, together, on
the same owner's 12 real text notes, so the Sonnet numbers are directly
comparable rather than mixed with SB-034's two-day-old Opus/Haiku run: 36
real API calls, real cost. Sonnet 5 tracked Opus at 83.3% on `category` and
`priority`, 75.0% on `suggested_action` (vs Haiku's 75.0%/58.3%/33.3%), and
— the specific test that broke Haiku — classified all three haircut-retry
notes (`08041e8e`, `cd4e6e6d`, `a6887370`) as `task`, matching Opus
exactly and staying self-consistent where Haiku again flip-flopped
(task/task/event). Cost: $0.00665/note vs Opus's $0.00985/note — a flat
~0.6x from Sonnet's per-token price, holding regardless of cache hit/miss
because Sonnet's 1,024-token cache minimum (unlike Haiku's 4,096) clears
this ~2,169-token prompt (11/12 cache hits, same as Opus).

**Incidental finding, not this run's subject:** re-running Opus 5 fresh on
`cd4e6e6d` returned `category: task`; the *production* `note_enrichments`
row for that same note, from its real capture, reads `category: event`.
Same model, same prompt, same text — two different answers across two real
calls. Not a determinism guarantee to assume elsewhere in this project.

**No `ENRICHMENT_MODEL` change made.** This extends SB-034's evidence base
with a legitimate middle option — closer to Opus on every quality axis
measured, no self-inconsistency, ~1.5x cheaper — but switching is a product
call on an ~17–25% ambiguous-note disagreement rate, not something decided
here. Full tables: `docs/04-ai-pipeline.md` "Adding Sonnet 5 to the
comparison (2026-08-09)".

**2026-08-09, decided: switched to Sonnet 5.** Owner reviewed the table
above and chose it. `ENRICHMENT_MODEL` in `_shared/enrichment.ts` is now
`claude-sonnet-5`; `PROMPT_VERSION` unchanged (the model is not part of that
key, so existing `note_enrichments` rows stay attributed to whichever model
actually produced them). **Not yet run against a live Edge Runtime** — this
was a code-only swap; the first real proof of Sonnet 5 enrichment on a live
note happens under SB-016's hosted deploy, not before.

### SB-028 · Queue archive/dismiss while offline

**2026-08-07, local stack, a real disconnected backend, not a flag.**
`archiveNote`, `dismissNoteAction`, and `restoreNoteAction` now share
`writeNoteField()`: attempt the real write, and on any failure queue it in a
new IndexedDB store (`noteActions`) instead of throwing, so the caller (and
the existing optimistic UI update) proceeds regardless. `sync()` replays the
queue on the same reconnect trigger every other mutation already uses.

**Signed in for real** (OTP from Mailpit, `muhammad@example.test`, the
documented local test account), against a note seeded with a real
`suggested_action: "archive"` enrichment so the chips would render.

1. `docker stop supabase_kong_Second_Brain` — a genuine connection failure,
   not `navigator.onLine` toggled or a network throttle flag.
2. Clicked "تجاهل" (dismiss). **The card updated immediately** to the
   resolved state (`تم التجاهل` + `تراجع`) — no error, no `failed` state.
3. Confirmed the server had **not** moved: `action_dismissed_at` still
   `null` in Postgres.
4. Confirmed the write **had** been queued:
   `pendingNoteActions()` → `[{noteId, field: "action_dismissed_at", value:
   "2026-08-06T21:09:12.756Z", ...}]`.
5. `docker start supabase_kong_Second_Brain`, waited for `healthy`.
6. Called `sync()` directly. Queue drained: `pendingNoteActions()` → `[]`.
7. Confirmed the server row now reads
   `action_dismissed_at = 2026-08-06 21:09:12.756+00` — **the exact value
   queued while offline**, not a new timestamp from the replay.
8. Reloaded the page. The note shows with no action chips — genuinely
   answered server-side, not an in-memory illusion that a refresh would
   have undone.

Test note deleted afterward; the owner's 14 real notes were unaffected
throughout — the disposable test note belonged to a different account.

**A real bug in SB-003 was found and fixed in the course of this work**, not
a separate incident: `vite dev` was serving a strict CSP that silently
blocked React from ever mounting (the inline Fast Refresh preamble
`@vitejs/plugin-react` injects is blocked by `script-src` with no
`unsafe-inline`), so the very first attempt to test this feature in a
browser showed a blank page. Root-caused by manually importing modules one
at a time until one threw `"@vitejs/plugin-react can't detect preamble"`.
Fixed by dropping CSP from `vite dev` entirely — `server.headers` removed,
and the meta-tag plugin (which, unnoticed, was also running during `vite
dev` via the same `transformIndexHtml` hook `vite build` uses) scoped to
`apply: "build"`. Full correction recorded in SB-003's own entry above.
`vite preview` and the shipped `dist/index.html` — the surfaces SB-003's
original proof actually rested on — were never affected.

### SB-019 · Queryable pipeline failures over `ai_jobs`

**Done (2026-08-08).** Scoped with the owner first (`docs/13-tasks.md`): a
view, not alerting — no push/email channel, and the functions' scattered
`console.log`/`console.error` calls stay free-text, out of scope. `ai_jobs`
already carried `note_id`/`stage`/`status`/`error_code` on every attempt; the
gap was only that nobody had a query for "what's currently broken" without
writing one by hand.

`public.failed_ai_jobs` (migration `20260808000100_failed_ai_jobs_view.sql`)
returns one row per note+stage whose **most recent attempt** is `failed` — a
stage that failed once and later succeeded on retry must not appear, or the
view is noise instead of a punch list. Deliberately not granted to
`authenticated`: the intended reader is the owner via Supabase Studio, which
connects as the Postgres superuser and bypasses RLS entirely; exposing this
to the client role later would first need `security_invoker` on the view, or
`ai_jobs`'s own RLS (correctly scoped to `user_id`) would be silently
bypassed for every other authenticated user too.

**Proven wrong on purpose first**, the same discipline as `check-rtl.mjs` and
SB-010's tests: swapped in a naive version of the view (`status = 'failed'`
with no "latest attempt" logic) and it incorrectly showed 2 rows for a test
note where one stage had failed then succeeded on retry — caught by exactly
the assertion meant to catch it (`ERROR: BROKEN VIEW CAUGHT: failed_ai_jobs
showed 2 row(s), expected exactly 1`). Restored the real view and `verify.sql`
passed clean again, `ALL SCHEMA CHECKS PASSED`.

**Then read against real data, not just the test fixture:** the owner's live
`ai_jobs` table already had 15 real failing note+stage pairs sitting in it
from earlier sessions — 10 `missing_configuration` (the pre-fix ANTHROPIC_API_KEY
gap and every embed call, still blocked on SB-005/the Cohere key), 3
`embedding_failed`, 2 `transcription_failed` (blocked on SB-007) — all
correctly surfaced by `select * from failed_ai_jobs`, filterable by `note_id`
or `stage` with no other SQL needed. Applied to the live local database with
`supabase migration up --local` — not `supabase db reset`, which the
runbook's own quickstart uses but would have wiped the owner's real notes;
confirmed the note count was unchanged (15, before and after) throughout.

### SB-020 · Instrument the success metrics

**Done (2026-08-08).** Scoped with the owner first (`docs/13-tasks.md`): SQL
views checked manually in Supabase Studio, no new page in `web/`, no folding
into the digest. Two of the three named metrics
(`docs/10-product-spec.md`) were near-free — `stuck_notes` and
`note_cost`/`cost_summary` are views over data `notes`/`ai_jobs` already
carried. Capture latency (open → durable) had zero instrumentation
anywhere — the owner chose to include it rather than defer it.

**Capture latency, instrumented for real:** `web/src/data/outbox.ts`
`capture()` times its own IndexedDB `put()` (the exact write ADR-0001 calls
the durability guarantee) with `performance.now()`, stores the result on the
`OutboxNote`, and a second `put()` attaches it — deliberately **not**
awaited, so the durability-critical path costs exactly the one write it cost
before this change; losing the field to a killed tab costs a metrics sample,
never the thought. `capture_note` (migration `20260808000200_success_metrics.sql`)
gained a sixth, defaulted parameter to receive it. **A real
`create or replace function` bug surfaced immediately**: adding a parameter
to an existing function without dropping the old signature first creates an
*overload*, not a replacement — `capture_note(...) is not unique` on the
very first `verify.sql` run after the migration applied clean. Fixed with an
explicit `drop function if exists ... (uuid, note_source, text, text,
timestamptz)` before the new `create or replace`, confirmed exactly one
`capture_note` remained (`\df public.capture_note`), migration file corrected
to match (it had only been applied locally, never committed).

**Verified against a real browser, not just `verify.sql`:** signed in as
`muhammad@example.test` via real OTP (Mailpit), captured a real note ("SB-020
capture latency guard check note"), and read it straight back out of
Postgres: `capture_latency_ms = 73`, `status = ready` — the full path (client
timing → outbox → sync → `notes` Edge Function → `capture_note` RPC →
column) worked end to end, and enrichment still completed on the real
`ANTHROPIC_API_KEY`. `capture_latency_stats` picked it up immediately
(`notes_measured: 1, avg_ms: 73, p95_ms: 73`). No console errors. Test note
and its enrichment/tags removed afterward — the owner's 15 real notes were
never touched, confirmed by count before and after.

**Proven wrong on purpose**, same discipline as `check-rtl.mjs` and SB-019:
swapped in a `stuck_notes` missing the `archived_at is null` filter and it
incorrectly flagged a 3-hour-old archived note as stuck
(`ERROR: BROKEN VIEW CAUGHT: stuck_notes flagged an archived note`); restored
the real view, `verify.sql` passed clean again, `ALL SCHEMA CHECKS PASSED`.
`verify.sql` also asserts `capture_latency_stats`' percentiles against a
known fixture (100/200/300/400 ms → `p95_ms = 385` exactly, matching
`percentile_cont`'s documented interpolation) and `note_cost`/`cost_summary`
against seeded `ai_jobs` rows.

**Read against real data — two honest findings, not just "it works":**
- `stuck_notes`: **2 real notes** have been sitting in `queued` for **2,318
  minutes (~38.6 hours)** — both from the pre-key-fix period
  (`missing_configuration`), never picked up by a retry that could succeed.
  Real evidence the product-spec target of 0 is not currently met, and
  exactly the kind of thing this task was supposed to surface.
- `cost_summary`: average enrichment cost across 11 real notes is
  **$0.018827**, above the product spec's `< $0.015` target (and above the
  earlier $0.008–0.011 spot-measurement from SB-000f, which was 2 notes).

  **Investigated 2026-08-08, root cause found.** Split the 14 real successful
  `enrich` rows by `cached_tokens` (`_shared/pipeline.ts`'s own
  `PRICING.cacheWrite = 6.25`/M vs `PRICING.cacheRead = 0.5`/M — a 12.5x
  difference on the ~2169-token system prompt): **8 cache hits averaged
  $0.009359, 6 cache misses averaged $0.022039** — cost-per-call roughly
  doubles on a miss, exactly reproducing `costUsd()`'s formula by hand
  (e.g. a miss with `input=83, output=293, cached=0` costs $0.021296 only if
  ~2169 tokens were billed as `cache_creation_input_tokens` at 6.25/M — the
  math is exact, not approximate). Anthropic's cache TTL is 5 minutes;
  SB-000f's $0.008–0.011 figure was measured from 3 calls fired seconds
  apart in one test session — the *best case*, not a representative one.
  This product's own design (ADHD-first, capture whenever a thought occurs,
  ADR-0001) means real notes are naturally spread through the day, so most
  individual `enrich` calls land outside any 5-minute window and pay the
  cache-write price. Two notes (`a6887370`, `cd4e6e6d`) were also enriched
  2–3 times roughly a second apart — almost certainly manual re-invocation
  while testing, not independent real captures — which further inflates
  `note_cost`'s per-note total for those two rows specifically, since it
  sums every attempt. Net: **the $0.015 target assumed caching would land
  consistently; for this product's actual usage pattern it mostly won't**,
  and the honest steady-state figure is closer to the cache-miss price
  (~$0.02) than the cache-hit one. Not something SB-020 itself should fix —
  flagged here as a real finding, decision on whether to revise the target
  or attempt to change the usage pattern belongs to the owner.

  **Decision, 2026-08-08 (owner):** target revised from `< $0.015` to
  `< $0.02`, set at the measured cache-miss price rather than a discount off
  it — so the $0.018827 average now reads as **under target**, honestly,
  without touching the enrichment model or prompt. No quality tradeoff was
  made to hit this: Opus 5 stays the enrichment model (see SB-034, which
  already tested and rejected swapping in a cheaper model on quality
  grounds), and no prompt or caching behaviour changed. `docs/10-product-spec.md`
  "Success metrics" reflects the new target.
- `capture_latency_stats` had **0 measured notes** before the browser test
  above: every one of the owner's 15 real notes predates this
  instrumentation. The metric only starts accumulating from here forward.

Applied with `supabase migration up --local`, not `db reset`, for the same
reason as SB-019. `npm run verify` (typecheck, RTL guard, 22 tests, build)
passed clean after the client changes.

### The owner's own test session

The first time the product was driven by the person it is for, rather than by
whoever built it. Everything below was observed on his machine, in his browser,
against his own notes.

**Suggested actions work, and read as broken.** Both paths were exercised for
the first time:

| | result |
|---|---|
| أرشفة | card disappeared; `archived_at` set; still gone after a reload |
| تجاهل | `action_dismissed_at` set on 6 notes; chips gone after a reload |

The database confirms both. But the report was *"دوست عليه وماحصل أي شي"* — and
that is an accurate description of what is on screen. Answering a suggestion
makes two small links vanish and changes nothing else: no confirmation, no
movement, and for "راجعها لاحقًا" no destination either, since none exists
(SB-027). Archive only felt like it worked because the card left the screen.
Recorded as SB-033.

**The environment broke in a way worth writing down.** The local stack had been
started from inside a git worktree, so the Edge Runtime container's functions
mount pointed into that directory. Deleting that worktree during cleanup killed
the container with exit 255, and every symptom that followed — notes never
syncing, no classification, no action chips, empty search, and an error on the
notes screen — was that one container being down, since all four paths run
through Edge Functions. `supabase start` did **not** fix it; only a full
`supabase stop && supabase start` from the project root recreated the mount.

**A note that never syncs still shows.** While the functions were down every
capture stayed local and every card read "محفوظة على جهازك" — which is exactly
what should happen, and is only true because of SB-025. Before that change the
same failure would have produced an empty list under an error message.

### SB-016 · Deploy to a real hosted Supabase project

**Partly done (2026-08-09), real hosted infrastructure, one real blocker
found.** Project `hfjpotjbrrnghuqhxoux` (free tier), linked with a
Personal Access Token supplied by the owner (used only as a local env var
this session, never written to a file or committed).

**What actually ran, against the real hosted project, not simulated:**
- All 17 migrations applied via `supabase db push` — clean, no errors.
- `verify.sql`'s ~700 lines of assertions ran end to end via
  `supabase db query --linked` with the two `psql` meta-commands
  (`\set`, `\echo`) stripped, since that path executes over the Management
  API, not real `psql`. Zero exceptions raised across the whole run — every
  `raise exception` in the file would have aborted it, so a clean finish is
  a real pass. Honest gap: the Management API doesn't surface individual
  `raise notice 'PASS: ...'` lines the way local `psql` does, so this proves
  "nothing failed," not a line-by-line replay of the local check-by-check
  read-out.
- All 8 Edge Functions deployed (`delete-account`, `digest`, `enrich`,
  `export`, `notes`, `search`, `sweep`, `transcribe`).
- The real `ANTHROPIC_API_KEY` set as a hosted secret (confirmed present via
  `supabase secrets list`, value never echoed).
- The sweep/digest Vault secrets (`sweep_function_url`,
  `sweep_service_role_key`, `digest_function_url`,
  `digest_service_role_key`) were set for real, pointing at this project's
  actual function URLs and service-role key — then the two schedule
  migrations were re-run, and `cron.job` on the hosted database now shows
  **`sweep-worker` (`*/5 * * * *`), `digest-enqueue` (Saturdays 03:00 UTC),
  `digest-collect` (every 6h), and `ai-jobs-retention` (daily 03:00 UTC) —
  all four `active: true`.** Unlike local (SB-001/SB-017), this was left
  **on**, deliberately — hosted is the real environment this automation is
  for.

**Real blocker found, not yet resolved: sign-in does not work in
production as shipped.** The client's OTP screen requires a 6-digit code
typed from `{{ .Token }}`, which only exists because
`supabase/config.toml` carries a custom `magic_link` email template
(`supabase/templates/magic_link.html`) — `config.toml` governs the local
CLI stack only, it is never auto-applied to a hosted project. Verified live:
pointed `web/.env.local` at the hosted project (reverted after), signed in
as the owner's real email against the real hosted Auth. The email that
arrived was Supabase's **default "Confirm your email address" signup
link**, not a 6-digit code — because this was this email's first sign-in
against the *hosted* project (its own separate `auth.users`), which used
`enable_confirmations = true` on hosted (differs from local's `false`) and
sent the stock confirm-signup template. Attempting to fix this the
intended way, `supabase config push`, failed outright:

```
Email template modification is not available for free tier projects using
the default email provider. Please upgrade your plan or configure a custom
SMTP provider.
```

This is a hard platform restriction, not a bug in this project's code —
confirmed live, not assumed from documentation. **Free tier cannot serve
this app's sign-in flow as built**, regardless of the pause-on-inactivity
issue already known. Two ways out, either unblocks it: upgrade to Pro, or
configure a custom SMTP provider (Resend/SendGrid free tiers) while
staying on the free plan.

**Resolved, same day: owner configured Resend as custom SMTP** (free tier,
`onboarding@resend.dev` sender), then `supabase config push` succeeded —
`Remote Auth config is up to date`, confirming the custom OTP template
actually applied. (The push run also touched an unrelated Storage
`[vector]` setting inherited from `config.toml`'s scaffold, which failed
with `402 upgrade required` — irrelevant, since this project uses pgvector
directly in Postgres, not Supabase Storage's vector buckets; left alone.)

**Then the real end-to-end capture, and a second real bug found by
running it, not reading it:** signed in as the owner for real — the code
email arrived (landed in Spam, expected for a first-time send from
Resend's shared sandbox domain; not a project bug) — and captured a real
note. Enrichment failed **five times in ~2 seconds**, `error_code:
unknown`, no cost or latency recorded — too fast to be a real network
round-trip, and hosted Edge Function logs weren't ingesting yet (a
brand-new project's log pipeline; `postgres_logs` queried fine over the
same Management API, `function_edge_logs`/`function_logs` stayed empty).
Reproduced the exact SDK call locally instead (same pinned
`@anthropic-ai/sdk@0.115.0`, same real key, same request shape) and got
the real error immediately: **`'claude-sonnet-5' does not support the
`fallbacks` parameter`` (400).** `_shared/pipeline.ts`'s enrichment call
sent `betas: ["server-side-fallback-2026-07-01"]` /
`fallbacks: "default"` unconditionally — a resilience feature that was
never exercised for Sonnet 5 before now, since this model swap and this
project's first-ever hosted deploy happened in the same session. Fixed by
removing both fields (Sonnet 5 doesn't need or support them); confirmed
against the local repro first, then redeployed `enrich`/`sweep`/
`transcribe` (all three bundle `pipeline.ts`) and re-triggered the same
stuck note with `force: true` directly against the hosted function.

**Real, complete proof, on the hosted project, no local stack involved:**

```
status: ready
category: task
priority: normal
model: claude-sonnet-5
job_status: succeeded
cost_usd: 0.019376
```

The note (`اختبار النشر الحقيقي على المشروع المستضاف — SB-016`) is real,
captured through the real UI, signed in via a real email, enriched by the
real hosted `enrich` function calling the real Anthropic API. Left in
place as evidence, clearly labelled as a test capture.

**PWA hosting, same day: Cloudflare Pages, and a third real bug found.**
Built the production bundle against the hosted Supabase project
(`web/.env.production.local`, gitignored, removed after); confirmed the
built `index.html`'s CSP `connect-src` named the hosted origin, not
localhost. Deployed via `wrangler pages` (owner-supplied scoped API
token, used only as a local env var) to a new project `wamda` — live at
**https://wamda-a8k.pages.dev**.

Before locking down `ALLOWED_ORIGIN` to that real origin (SB-010's own
accept line: a foreign origin should be rejected), read `_shared/http.ts`
again and found a real latent bug: `json()` used a `CORS_HEADERS` constant
computed **once at module load**, not `corsHeaders()` called fresh per
request the way `preflight()` correctly does. `ALLOWED_ORIGIN` would have
applied to preflight rejections but not reliably to the
`Access-Control-Allow-Origin` header on actual responses, depending on
whether an isolate was warm from before the secret existed. Fixed by
having `json()` call `corsHeaders()` directly and removing the frozen
export; no test referenced the removed constant. Set
`ALLOWED_ORIGIN=https://wamda-a8k.pages.dev` as a hosted secret,
redeployed all 8 functions so every isolate reads it fresh, and confirmed
sign-in and capture both still work cleanly from the real production
origin (no CORS errors in the console).

**Final full-loop proof, no localhost involved anywhere:** opened
https://wamda-a8k.pages.dev for real, signed in with a real email (one
OTP code was already expired by the time it was read — `otp_expired`,
ordinary code-entry latency, not a project bug — the resend worked),
captured a note, and it reached `status: ready` on its own. SB-016's full
accept line is now met: migrations applied, functions deployed, secrets
set, **the PWA served over HTTPS**, and **one real note captured on it**.
`web/.env.local` was restored to the local stack throughout; this
worktree's default dev target is unchanged.

## Seven real bugs this caught

1. **Missing table grants.** RLS policies were correct, but `authenticated`
   had no table-level privileges — every client query would have failed
   `permission denied for table notes`. The schema was relying on Supabase's
   implicit default privileges, which depend on which role ran the migration.
2. **PostgREST type inference** through an embedded relation made every field
   access on the timeline query a type error.
3. **`Messages` derived from an `as const` object** required the English
   catalogue to equal the Arabic *text*, not just its keys — 39 compile errors.
   Fixed with a mapped type that widens values to `string`.
4. **Dual Vite type identities.** vitest 2 bundles its own nested Vite 5
   alongside Vite 6, so the PWA plugin was unassignable to `PluginOption`.
   Fixed by matching majors (vitest 3), not by casting the error away.
5. **Notes stranded in a non-terminal state** when enrichment failed — see the
   section above. The most consequential of the six: it silently loses notes
   from the user's view.
6. **`sync()` burned retry attempts while signed out**, incrementing `attempts`
   on every queued note against a guaranteed 401. A user capturing for a week
   before signing in would accumulate a large attempt count on notes that were
   never broken, poisoning the one signal meant to identify genuinely stuck
   items.
7. **An optional stage was treated as fatal.** A misconfigured *embedding* key
   made the entire request throw, resetting the note to `queued` — even though
   the expensive Anthropic call had already succeeded and been persisted. The
   note could never reach `ready`, so it stayed invisible in the timeline while
   its enrichment sat in the database, paid for and unused. Stages 4–5 are now
   isolated: without embeddings a note still has a summary, category, tags, and
   lexical search, and is only missing from *semantic* results. A missing
   `note_embeddings` row is its own backfill marker.

None were visible by reading the code. Number 7 in particular only appeared
because a second vendor key was absent while the first was present — a
combination no test suite was going to stumble into.

## An operational gotcha worth knowing

**The local Edge Runtime serves stale compiled code after a file edit**, and
`docker restart supabase_edge_runtime_*` is *not* enough to clear it — the
container demonstrably read the updated file (verified by `grep` inside it)
while still executing the previous version. A full `supabase stop && supabase
start` was required.

Budget for this when iterating on functions: a fix that "doesn't work" may
simply not be running. Confirm by adding a distinctive log line rather than by
re-reading the code.

## Did NOT run

### Anything requiring a vendor API key

No `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, or `COHERE_API_KEY` was
available, so none of these executed against a real service:

- **Transcription.** Scribe's response shape — particularly the per-word
  probability field used for confidence — is written from documentation and has
  not been observed. Expect to adjust `ScribeASR.transcribe`.
- **Embeddings and semantic search.** `COHERE_API_KEY` was never supplied, so
  the semantic arm has never run. Search was exercised lexically only, with
  `p_embedding => null`, and `note_embeddings` is empty. Cross-lingual
  retrieval — the phase-2 claim that an Arabic query finds an English note —
  therefore remains entirely untested.
- **Relation detection.** `relate_note()` needs an embedding, so it has never
  produced a row either.
- **Weekly digest.** Batch submission and collection never executed.
- **Cross-lingual retrieval.** The phase-2 claim that an Arabic query finds an
  English note is a property of the chosen model, untested here.

### Client-side gaps

- ~~**Voice capture never ran.**~~ **Superseded — it ran.** Found in the local
  database on 2026-08-02: two notes with `source = 'voice'` and two matching
  objects in the private `audio` bucket, **173 210 bytes** and **8 024 bytes**,
  both `audio/webm`, both under the capturing user's own prefix.
  So `MediaRecorder` produced real Opus/WebM audio, and the direct
  client → Storage upload under a signed URL worked — the step that exists so
  25 MB of audio never routes through an Edge Function.
  Both notes then resolved to `failed` at the `transcribe` stage with
  `error_code = transcription_failed`, attempt 1. That is the expected outcome
  with no ElevenLabs key; whether the call actually reached ElevenLabs is not
  determinable from the job row alone.
  Still untested: iOS Safari, where `MediaRecorder` availability is the open
  question, and transcription itself.
- **Only Chromium.** No Safari or Firefox testing. iOS install flow untested.
- ~~**No visual screenshot.**~~ **Partly superseded.** The capture screen has
  now been looked at in both colour schemes at 375×812 — which is how the
  dark-mode button bug above was noticed at all. Still unseen: notes, search,
  digest, auth, and every screen at any other width.
- **Arabic font not bundled.** `global.css` names IBM Plex Sans Arabic /
  Noto Sans Arabic first, but neither is shipped — rendering currently falls
  back to a system face.

## What to run first

```bash
# backend — should reproduce the 12 passes above
supabase start && supabase db reset
docker exec -i supabase_db_Second_Brain psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/verify.sql

# client — should reproduce typecheck + 21 tests + guard + build
cd web && npm install && npm run verify
```

Then phase 2 with a real `ANTHROPIC_API_KEY`, watching for
`prompt_cache_miss` in the function logs.
