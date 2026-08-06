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

**Dev mode re-checked separately** (HMR, React Fast Refresh) with the same
header live on `vite dev`: hot updates to the 4 edited files applied, the
Vite HMR websocket (`ws://` back to the same origin) connected without a
single `csp_violation` in console. Nothing in the daily inner loop needed a
relaxation.

**What this does not cover, stated honestly:** `frame-ancestors` and
`report-to` cannot live in a `<meta>` CSP at all — the served header carries
`frame-ancestors 'self'`, but the meta-tag fallback baked into the static
build does not, so a host that serves the built files with no server-side
header config (a plain static host) ships without clickjacking protection.
Whatever host SB-016 picks must set both at its own header layer. Violation
reporting today is `console.error` client-side only — visible in DevTools,
not centralized; a `report-to` collector is real future work, not attempted
here, once SB-019 (structured logging) gives it somewhere to land.

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
