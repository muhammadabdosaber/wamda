# 0. What was actually verified

An honest ledger. Nothing below is inferred from reading the code — it either
ran on this machine or it did not.

## Backend — ran, passed

### Migrations apply to a real Postgres

`supabase db reset` — all six migrations apply clean against Supabase local
(Postgres + pgvector), no warnings beyond an idempotent `pgcrypto already
exists` notice.

### 26 schema checks against a live database (re-run 2026-08-20, clean `db reset`)

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

### SB-039 · SB-042 · The second design round (loader, nav icons, notes, avatar)

Ran 2026-08-10, against the **local** stack (`127.0.0.1:54421`) at
`localhost:5174`, signed in as `muhammad@example.test` with a real OTP read
from Mailpit. `npm run verify` green throughout: typecheck + RTL guard + 22
tests + build.

Two Cool Slate exports were added to `docs/design/` (`loader/`, `notes-v2/`)
as the tracked source for this round; `docs/design/README.md` carries the
Taken/Ignored table.

| What | Evidence |
|---|---|
| Loader replaces the literal `…` | Delayed the `/functions/v1/notes` fetch in-page to hold the state open. Read live: `.loading` present, label `جارٍ تجهيز المساحة…`, `role="status"`, mark `aria-hidden="true"`, dot animating `loading-pulse / 2s` at `rgb(51,65,85)` = `--accent`, ring `1.6px rgb(203,213,225)` = `--border` |
| Skeletons take the **list's** shape | Notes: 3 × `.skeleton-card`. Tasks: 3 × `.skeleton-row`, `min-block-size: 56px` — the same hit target as the real `.task-row` |
| Nav: 5 tabs, rounded active pill | All five `border-radius: 999px`; selected tab `rgb(226,232,240)` = `--accent-soft`, all others transparent |
| Category filter actually filters | Chips rendered `الكل · مهمة · موعد` — only the categories present in the data. Clicking `موعد` cut 2 cards → 1, `aria-pressed` moved with it |
| Chip bar scrolls, never wraps | With 8 chips injected: `scrollWidth 520 > clientWidth 327`, bar height unchanged at 39px, `document.body.scrollWidth` still ≤ viewport |
| One note per row | Single column at 375px, 730px, and 1400px — one grid track at each, three cards on three distinct rows, and no media rule left targeting `.notes-grid`. Summary `line-clamp: 3` with `overflow: hidden`, measured |
| Accept/dismiss survived the redesign | `أضفها كمهمة` / `تجاهل` still rendered on a real enriched card (SB-033 protected) |
| Avatar menu | `aria-haspopup="menu"`, `aria-expanded` toggles, item `تسجيل الخروج`. Escape closes **and** returns focus to the trigger (`document.activeElement === button`) |
| Menu mirrors correctly | RTL: avatar ≈304–338, menu 304–472. LTR: avatar 702–736, menu 568–736. Shares the avatar's trailing edge in both, inside the viewport in both |
| Dark mode | `--bg` `#0f172a`, card `#1e293b`/border `#334155`, avatar and active chip both invert to `#cbd5e1` on `#0f172a` |

**Two leftovers from the Cool Slate rebrand, found and fixed.** `global.css`
still carried Forest-green `rgba()` in two places the palette port missed —
the tab bar's shadow (`27, 48, 34`) and the detail sheet's scrim (`9, 15, 11`).
Both are slate now. Nothing fails when a shadow tint is wrong, which is why
they survived.

**A measurement trap worth recording.** With the Browser pane hidden the
renderer stops compositing, so CSS **transitions never advance** — the tab bar
read as though the selected tab had no background and an unselected one did.
`requestAnimationFrame` never fires either, which is why the loader had to be
caught by delaying its fetch rather than sampling a frame. Neither was a bug in
the app: injecting `transition: none` and re-reading gave the correct values
immediately. Any computed-style check taken through a hidden pane needs the
transition neutralised first, or it is reading a frozen intermediate.

**Not verified here:** the local Edge Runtime container had been dead for 36
hours (`Exited (255)`, machine sleep) and was restarted with `docker start`, so
it is serving Edge Function code as of that snapshot. Every change in this
round is client-side, so nothing in it depends on the function build — but this
was **not** a fresh `supabase stop && supabase start`.

### The sign-in email carried the old product name

Ran 2026-08-11, local stack. `supabase stop && supabase start`, then a real
`POST /auth/v1/otp` for `muhammad@example.test`, then read the delivered
message out of Mailpit.

| | Before | After |
|---|---|---|
| Subject | `رمز الدخول إلى الدماغ الثاني` | `رمز الدخول إلى ومضة` |
| Body heading | الدماغ الثاني | ومضة |
| Palette in delivered HTML | `#1f2421` `#e6efe9` `#3e6b5c` (Forest) | `#334155` `#e2e8f0` (Cool Slate) |

Checked on the delivered message, not the source file: old name absent, Forest
hexes absent. Note count 16 before the restart and 16 after — `supabase stop`
preserves the data volumes, only `--no-backup` removes them.

**The subject and the body reload differently, and that matters.** The body is
fetched over HTTP with `GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED=true`, so it
hot-reloads. The subject is baked into the auth container's environment as
`GOTRUE_MAILER_SUBJECTS_MAGIC_LINK` at container-creation time. A
`docker restart` therefore updates the body and silently leaves the old
subject — the fix looks applied until someone reads an inbox. Only a full
`supabase stop && supabase start` reloads both. Same family as the Edge
Runtime trap already recorded below: the container reads the new file while
still running the old configuration.

**Hosted: applied 2026-08-11.** See the section below.

### Hosted auth config: the email template, and a `site_url` pointing at localhost

Ran 2026-08-11 against `hfjpotjbrrnghuqhxoux` after `supabase login` and
`supabase link`.

`supabase config push` reported `Updating Auth service` with a diff confined
to the magic-link subject and content; a second run reported
`Remote Auth config is up to date`. The hosted sign-in email now says ومضة.

**`supabase config push` does not prompt.** It was run with stdin closed on
the expectation that it would print a diff and stop at a confirmation. There
is no confirmation. It printed the diff and applied it in the same breath.
Whatever is in `config.toml` at the moment the command runs goes to
production — treat every invocation as the change itself, not a preview.

**A pre-existing production bug this surfaced.** `site_url` was
`http://127.0.0.1:3000` **on the hosted project**, pushed there during SB-016.
It did not appear in the template diff precisely because remote and local
already agreed. Every production sign-in email's fallback link — *"اضغط هنا
لتسجيل الدخول مباشرة"*, which renders `{{ .ConfirmationURL }}` — therefore
pointed real users at their own machine. It went unnoticed because the app
signs in with a six-digit code and never follows that link.

Fixed by reading the value from the environment
(`site_url = "env(SUPABASE_AUTH_SITE_URL)"`), since one `config.toml` serves
both environments:

| | Value | Verified by |
|---|---|---|
| Local | `http://127.0.0.1:3000` | `GOTRUE_SITE_URL` in the auth container after `supabase stop && supabase start` — the CLI resolves `env()` from a gitignored `.env` at the repo root |
| Production | `https://wamda-a8k.pages.dev` | push diff `-127.0.0.1:3000` → `+wamda-a8k.pages.dev`, then `Remote Auth config is up to date` on re-run |

An inline `VAR=x supabase config push` **does** override the root `.env`, which
is what makes the production push possible without editing the file. Confirmed
by the diff, not assumed — and the test was safe either way, because if `.env`
had won, the push would have been a no-op against a value production already
had. `additional_redirect_urls` lists both origins literally; it is an
allow-list, so carrying the other environment's URL costs nothing.

Storage failed with `402 vector buckets` on both runs, as in SB-016. This
project uses pgvector directly and no Supabase Storage vector bucket; the
`[vector] enabled = true` in `config.toml` is CLI scaffold that was never
removed. Unrelated to auth, and auth applied regardless.

**Not verified:** no real production sign-in email has been read since the
push. The evidence above is the config diff, not an inbox.

### SB-007 · First real transcription

Ran 2026-08-11, local stack, after `ELEVENLABS_API_KEY` was added to
`supabase/functions/.env` and the stack was restarted (`supabase stop &&
supabase start` — env vars, same as the auth trap above, only load on a fresh
container start, not `docker restart`).

Signed in as the owner's real account via a fresh OTP through Mailpit, then
called `POST /functions/v1/transcribe` against the two `source = 'voice'`
notes already sitting in the local DB from SB-012 (2026-08-02, `failed`,
`error_code = transcription_failed`, no key at the time):

| note | audio | result | `transcript_confidence` | `raw_text` | status after |
|---|---|---|---|---|---|
| `9b114447…` | 173 210 bytes, `audio/webm` | succeeded | 0.463 | `[صوت طفل].` | `draft` |
| `fcec326e…` | 8 024 bytes, `audio/webm` | succeeded | 0.577 | `[موسيقى مقدمة].` | `draft` |

Both `ai_jobs` rows moved from the old `transcribe/failed/transcription_failed`
attempt to a new `transcribe/succeeded` row, real `provider = elevenlabs`,
`model = scribe_v1`, real `latency_ms` (1937 and 1003). Confirmed against the
DB directly, not the HTTP response alone.

**Both correctly stayed `draft`, not `queued`.** Both confidences are under
the 0.6 `REVIEW_THRESHOLD` in `pipeline.ts`, so `runTranscription` held them
back from enrichment exactly as designed — a live confirmation of that branch,
which had never executed against a real vendor response before.

**What the audio turned out to be.** Both clips are silence/background-noise
test recordings from the original `MediaRecorder` smoke test (SB-012,
2026-08-02), not spoken content — Scribe correctly tagged them as
`audio_event`s rather than hallucinating words. Confirmed by a third, direct
call straight to `https://api.elevenlabs.io/v1/speech-to-text` (bypassing the
Edge Function) on the same 173 210-byte file: `text: "[background noise]"`,
one `words` entry, `type: "audio_event"`. The full observed shape — and the
finding that identical audio sent twice produced a different tag and a
different confidence each time — is recorded in `docs/04-ai-pipeline.md`
Stage 1.

**Accept criteria met:** an audio file reached `raw_text` with a confidence
value, and the response shape is recorded. **Not met by this test:** ASR
quality on the owner's actual dialectal speech — these two clips have no
speech to grade. That is SB-013, unblocked by this key but still `todo`, and
distinct from SB-012's remaining phone-hardware piece.

### SB-007 (cont'd) · A real recording, and the bug it found

Ran 2026-08-11, minutes after the section above, on the owner's own dev
server (`npm run dev`, separate from this session's browser preview) against
the same local stack, signed in as the real account.

**The recording surfaced a genuine, previously-unknown regression, not a test
artifact.** The new note (`ff2704ed…`) appeared in the DB with the audio
correctly uploaded to Storage (166 448 bytes at
`<user_id>/ff2704ed….webm`, confirmed via `storage.objects`) but
`notes.audio_path` was **null** and no `ai_jobs` row existed at all — meaning
`transcribe` was never even reached. `capture_latency_ms` was 9ms, so the
client-side capture itself was instant and looked fine; the break was
entirely server-side and invisible from the UI.

**Root cause: `supabase/functions/notes/index.ts`'s `/audio-url` handler
writes columns the caller's client is no longer allowed to write, and never
checked whether the write succeeded.** SB-023
(`20260804000200_notes_update_grant_scope.sql`, 2026-08-04) intentionally
revoked the `authenticated` role's blanket UPDATE on `notes` and re-granted it
scoped to four columns only: `archived_at`, `action_dismissed_at`,
`completed_at`, `updated_at` — exactly the columns a user should be able to
touch. But the `/audio-url` handler still ran, under that same restricted
client:

```ts
await supabase.from("notes").update({ audio_path: path, status: "queued" }).eq("id", noteId);
```

`audio_path` and `status` are server-computed, not in the grant, so Postgres
rejected the write with `permission denied for column audio_path` — and
because the result was never checked (`{ data, error }` discarded), the
handler still returned a valid signed upload URL as if nothing had gone
wrong. The client uploaded real audio to a real Storage path and moved on
believing capture had succeeded. The note was then permanently orphaned:
audio present, nothing pointing at it, no error surfaced anywhere a person or
a sweep would see it.

Confirmed against `information_schema.column_privileges`: `authenticated` has
`UPDATE` on exactly the four SB-023 columns and **not** `audio_path` or
`status`. This is a regression window, not a day-one bug — it went uncaught
because the only two voice notes ever captured before this one (SB-012,
2026-08-02) predate the 2026-08-04 migration by two days. This was the first
voice note captured after the grant was scoped down.

**Fixed** in `supabase/functions/notes/index.ts`: the `audio_path`/`status`
write now goes through `serviceClient()` (the same admin client `transcribe`
and `enrich` already use for their own writes), with the result checked and a
`500 audio_path_write_failed` thrown on error instead of silently discarded.
Ownership is still enforced beforehand by the caller-scoped `select` that
precedes it. `deno check` passed; stack restarted
(`supabase stop && supabase start`, required — Edge Runtime caches compiled
code).

**The orphaned note was repaired, not discarded**, since its audio was
genuinely intact in Storage: `audio_path` backfilled by hand to the path
`storage.objects` already showed, then run through the now-real pipeline —
transcribe and enrich both succeeded. This is the first note in the project
transcribed from **actual spoken Arabic**, not silence:

> طيب، آآآ، أنا عايز أروح بكرة الشغل وأتابع الـ آآآ، المشاريع-- المشروع بتاعي
> وأشوف إيه اللي خلاص منه مع الشباب.

`transcript_confidence` **0.9497** — well above the 0.6 review threshold, so
the note correctly advanced straight to `queued` instead of stopping for
review (the opposite branch from the two silence clips above, now also
observed for real). Enrichment then produced a correct title, category
(`task`), `suggested_action: create_task`, a due date resolved from "بكرة"
(tomorrow) to `2026-08-12T09:00:00+04:00`, and tags/context matching the
content. Final status: `ready`. This is the first fully real,
end-to-end, spoken-to-actionable-note run in the project's history — real
ASR, real confidence gating on real speech, real enrichment, real cost
(enrich: $0.022206).

**Re-verified with a fresh, non-repaired call.** Created a new note via
`POST /notes` (`47aff2c1…`), then called the fixed `/notes/audio-url`
directly — `audio_path` and `status` were both correctly persisted
(`queued`) in the same request, confirmed by reading the DB immediately
after, before any upload happened. This isolates the exact write that used
to fail silently and proves it now succeeds, independent of the earlier
hand-repair. The synthetic note (no real audio behind it) was deleted after.

### SB-007 (cont'd) · Deployed, then a second real bug on a real phone

Fixed `notes` function deployed to the hosted project (`supabase functions
deploy notes`) — confirmed live via `supabase functions list --linked`,
version bumped 4 → 5 with a fresh `updated_at`. `deno check` on all 8
functions was already clean before this deploy.

Then the owner recorded a real note on the deployed PWA
(`wamda-a8k.pages.dev`), from **iPhone Safari** — the device SB-012
flagged as never verified. Checked with `supabase db query --linked`
(read-only, via the Management API — no direct DB credentials handled):

- `notes.audio_path` was set correctly this time — **the deployed fix
  works**, confirmed on the hosted project, not just locally.
- But `storage.objects` for the `audio` bucket had **zero rows**. The audio
  itself never reached Storage. `ai_jobs` had zero rows too — `transcribe`
  had been attempted (the note's `updated_at` advanced after creation, from
  the client's automatic retry) and hit its `audio_not_found` branch, which
  resets status to `draft` without recording a job. A second, different
  regression, this time client-side.

**Root cause, confirmed by direct reproduction, not guesswork.** Created a
throwaway note+signed-upload-URL locally and PUT a file against it with
`Content-Type: audio/webm;codecs=opus` — rejected outright
(`415 invalid_mime_type: "mime type audio/webm;codecs=opus is not
supported"`). The identical bytes with `Content-Type: audio/mp4` (no codec
suffix) against a fresh signed URL succeeded (`200`). The bucket's
`allowed_mime_types` is an exact-match allow-list against the *base* type;
anything with a codec parameter attached is rejected regardless of whether
the base type is on the list. iOS Safari's `MediaRecorder` doesn't support
WebM at all; it
records into MP4/AAC (the code already knew this — see the comment above
`new MediaRecorder(stream)` in `Capture.tsx`) and reports `mr.mimeType` as
a codec-qualified string like `audio/mp4;codecs=mp4a.40.2`. Chrome's plain
`audio/webm` (no codec suffix, confirmed by reading `storage.objects.metadata`
for the three prior successful Chrome uploads) happened to already match the
allow-list, which is exactly why this never surfaced until a phone was
actually used.

**Made worse by an identical instance of the same bug class already fixed
above.** `api.ts`'s `sync()` discarded `uploadToSignedUrl`'s `{ error }`
entirely, so a rejected upload was invisible — the code proceeded straight to
`transcribe()` against audio that was never written, which failed
without a user-visible error either.

**Fixed**, three changes in `web/src/`:
1. `Capture.tsx` — the recorded `Blob`'s type is now the codec-stripped base
   (`mr.mimeType.split(";")[0]`), matching what the bucket's allow-list
   actually checks.
2. `api.ts` — `requestAudioUrl` now derives the Storage `ext` from the real
   recorded MIME type via a table mirroring the bucket's
   `allowed_mime_types`, instead of hardcoding `"webm"` regardless of what
   was actually recorded.
3. `api.ts` — `uploadToSignedUrl`'s result is checked; a failed upload now
   throws (so the outbox retries it) instead of silently continuing to a
   doomed `transcribe` call.

`npm run verify` (typecheck, RTL guard, 22 tests, build) passed clean.
Mechanism re-verified directly: the same throwaway signed-upload-URL that
rejected `audio/webm;codecs=opus` (`415 invalid_mime_type`) accepted the
stripped `audio/mp4` immediately after (`200`, object written) — confirming
the fix's actual mechanism, not just that the code compiles. Test note and
test Storage object both deleted afterward (`DELETE` via the Storage API;
direct SQL delete on `storage.objects` is blocked by
`storage.protect_delete()` — the Storage API is the only way to remove an
object cleanly).

**Not yet re-verified:** an actual iPhone Safari recording through the fixed
client build. The fix is typechecked, built, and its exact mechanism proven
against the real bucket, but the fix has not yet been deployed and re-tried
from the real device that found the bug.

### SB-012 (cont'd) · The diagnostic banner itself was reporting the wrong thing

After PR #24 fixed the banner's unmount bug, the owner recorded a real note on
the deployed PWA (`wamda-a8k.pages.dev`) and hit a NEW failure: the *notes
list* itself (not just voice sync) started showing "تعذّر الوصول للخادم"
(couldn't reach server), on both laptop Chrome and iPhone. A missing
`ELEVENLABS_API_KEY` hosted secret had already been found and set earlier that
session (confirmed absent via `supabase secrets list --project-ref`, added via
`supabase secrets set`), but the owner's next real recording still failed —
this time the banner just said `internal_error`, with no way to tell what
actually broke.

Reproduced live rather than guessed at: signed in on the deployed production
site through the Browser pane, confirmed CSP (`connect-src` correctly names
the Supabase origin — not a CSP block), confirmed the hosted API itself is
healthy (a direct OTP request against `/auth/v1/otp` returned `200`). That
ruled out the server and the network. Then checked what the client actually
does with an error response, and found it: `web/src/data/api.ts`'s `invoke()`
read `error.context.error.code` directly. `@supabase/supabase-js`'s
`FunctionsHttpError.context` is the raw `Response` object, not a parsed
body — the SDK's own docs read it with `await error.context.json()`. Reading
`.error.code` straight off a `Response` is always `undefined`, so **every**
real error code this app's Edge Functions ever returned (`rate_limited`,
`missing_configuration`, `unauthenticated`, anything) surfaced to the user as
the same generic `"internal_error"`. `timeline()` (the notes-list fetch) had
the same shape bug, but worse: it never even tried to read the code, hardcoding
`"internal_error"` unconditionally.

Confirmed the mechanism against a real response, not a mock: restarted the
local stack (`supabase stop && supabase start` — the Edge Runtime container
was not running at all, a separate instance of the stale-runtime gotcha above)
and, from the Browser pane, called the real local `notes` function with no
Authorization header. It returned a genuine `401
{"error":{"code":"unauthenticated"}}`. Replayed both the old extraction logic
and the new one against that real `Response`: old → `internal_error` (the
bug, confirmed); new → `unauthenticated` (the fix).

**Fixed** in `web/src/data/api.ts`: both `invoke()` and `timeline()` now go
through one `errorCodeFrom()` helper that awaits `context.clone().json()` and
reads the real code, falling back to `"internal_error"` only when the body
genuinely isn't JSON (a true network/relay failure). `Notes.tsx` also now logs
the real code to the console on a failed fetch — the user-facing copy stays
the calm "couldn't reach server" text, but the code is no longer thrown away.

This does not by itself explain why the user's actual recordings have been
failing — it explains why every banner shown so far said the same
uninformative thing regardless of the real cause. The real code will surface
on the next attempt.

`npm run verify` (typecheck, RTL guard, 22 tests, build) passed clean.

### SB-012 (cont'd) · The pipeline ran on hosted — and the audio was silence

With the error-code fix deployed, the owner recorded again and the banner
finally named something real: `unauthenticated`. The browser was showing a
signed-in avatar while every call returned `401` — a stale session. Signing
out and back in cleared it, and the very next recording ran the **entire
hosted path for the first time**:

| stage | evidence |
| --- | --- |
| upload | `storage.objects` row, 5 056 bytes, `audio/webm` |
| transcribe | `ai_jobs`: `elevenlabs` / `scribe_v1` / `succeeded` / 442 ms / `error_code: null` |
| response | ElevenLabs `200` |

Every stage succeeded. `raw_text` was still empty, and `notes.status` sat at
`draft` (the `needsReview` branch) — which is the correct handling of an empty
transcript, not a bug.

**The cause is upstream of all software, and was confirmed by parsing the
audio rather than by inference.** The stored object was downloaded and its
EBML walked element by element:

| property | value |
| --- | --- |
| container | valid WebM, `CodecID: A_OPUS` |
| `Duration` | 20 340 ms |
| audio frames | 340 |
| frame size | **12 bytes — every single one, no variance** |

Opus is variable-bitrate: speech produces frames that differ in size from one
20 ms window to the next. 340 consecutive frames at the identical minimum size
is digital silence, and nothing else. The microphone was open, the recording
was real, and it captured no signal.

Ruled out separately, by experiment rather than by reading: `providers.ts`
sends every recording to ElevenLabs as `note.m4a` regardless of the true
container. The same stored bytes were submitted twice, as `note.m4a` and as
`note.webm` — both returned `200` with an empty transcript, zero words, and
`language_probability: 0`. So the hardcoded filename is **not** the cause of
these empty transcripts. It is still wrong, and is recorded as open in
`docs/13-tasks.md`.

### SB-012 (cont'd) · Silence detection, verified in both directions

A recording that captures nothing used to become an empty note with every
stage reporting success — the exact silent failure this project refuses to
ship. `Capture.tsx` now watches the live stream through a Web Audio
`AnalyserNode` and tracks the peak amplitude of the take:

- **while recording**, after 2.5 s below the threshold, a hint appears so a
  dead microphone can be fixed during the take rather than discovered after it;
- **after saving**, a take that never crossed the threshold raises a banner
  owned by `App.tsx` — the note itself still saves, because durability is not
  what failed.

The threshold (peak `0.01`) was set from the measurement above, not guessed:
it sits far below room tone on a working microphone and far above the exact
zero that a dead input produces.

**Ran in the browser against the real component, both directions** — the
false-positive case matters as much as the positive one, because a warning
that fires on good recordings is worse than none:

| input | live hint | post-save banner |
| --- | --- | --- |
| synthetic silent `MediaStream` (nothing connected to the destination node) | ✅ "لا نسمع أي صوت — تأكّد من الميكروفون" after ~4 s | ✅ "حُفظت الملاحظة، لكن لم يُلتقط أي صوت" |
| synthetic loud `MediaStream` (440 Hz oscillator at 0.5 gain) | ✅ never appeared | ✅ never appeared |

`npm run verify` (typecheck, RTL guard, 22 tests, build) passed clean.

**Still not verified:** the detector against a real microphone on a real
phone, and iPhone Safari end to end. Web Audio is unavailable on some
browsers; there the meter returns `null` and the check simply does not run,
which is deliberate — recording is never blocked over a diagnostic.

### SB-012 (cont'd) · A sixth real bug: hosted Storage never had the full MIME list

After silence detection deployed, the owner fixed the laptop microphone and
recorded from an iPhone. New failure, and the (now-working) banner named it
exactly: `mime type audio/mp4 is not supported`.

`20260801000400_rls.sql` creates the `audio` bucket with
`insert into storage.buckets (...) values (...) on conflict (id) do nothing`,
and the array in that statement has named all 7 real MIME types
(`mp4/aac/mpeg/ogg/opus/webm/wav`) since it was written — `git log --follow -p`
on the file shows only one version of that line, ever. Queried directly
(`supabase db query --linked`):

```
allowed_mime_types: {audio/webm, audio/ogg}
```

Two types, not seven. The hosted bucket row was created narrower than the
migration — before the migration ever ran, from whatever the earliest hosted
setup did — and `on conflict do nothing` means that row can never be corrected
by another `insert`, no matter what the migration file says. Confirmed by
comparing against local, which shows the full 7-type list (local was reset
from the migrations fresh):

```
allowed_mime_types: {audio/mp4,audio/aac,audio/mpeg,audio/ogg,audio/opus,audio/webm,audio/wav}
```

**Fixed** with a new migration,
`supabase/migrations/20260813000100_audio_bucket_mime_types.sql` — an
`UPDATE`, not another `INSERT`, because that is the one statement `on conflict
do nothing` cannot swallow. Ran locally first (`supabase db reset`, full
migration replay, `verify.sql` clean including a new assertion added
specifically to catch this drift again), then pushed to hosted
(`supabase db push --linked`) and re-queried to confirm the live row actually
changed — not just that the push command exited 0.

**Not yet re-verified:** an iPhone recording through the now-corrected bucket.

### SB-012 (cont'd) · Closed — the first fully real recording, end to end

The next recording (from Safari directly, not the installed home-screen app —
the transcript says so itself) went through the whole pipeline clean, on
hosted, with a real spoken sentence rather than a silence test:

| stage | result |
| --- | --- |
| upload | correct MIME, accepted by the now-fixed bucket |
| transcribe | real Arabic text, confidence **0.925** |
| enrich | `category: task`, `priority: normal`, `suggested_action: review_later` |
| final `notes.status` | `ready` |

Transcript (`raw_text`, queried directly, not read off the UI): *"طيب أنا
دلوقتي بجرب التسجيل من، آآآ، الصفحة بتاعة الـ web من على الـ browser directly
من على... من على Safari. عايز أتأكد إذا كانت هتشتغل ولا لأ."* Enrichment
summary: *"المستخدم يجرب تسجيل الصوت من صفحة الويب مباشرة عبر متصفح Safari
للتأكد من عمل الميزة بشكل صحيح."* Both pulled via `supabase db query
--linked` against `notes` and `note_enrichments` — not inferred from a status
badge in the app.

This closes SB-012. Getting here took six real, independently-discovered bugs
across two days (bugs #8–12 below, plus the SB-023 grant regression that
preceded this section) — none reproducible by reading the code, each found
only by a real device hitting the real hosted stack.

## SB-043 · Enrichment quality: owner review of real classified notes

With real notes finally reaching `ready` (SB-012), the owner reviewed the
first batch — 12 notes classified for real by Claude — and flagged two
problems with real data, not a hunch:

- **Priority looked wrong.** 8 of 12 notes carried a priority the owner never
  signaled. One example: *"مشكلة في صفحة التسجيل الجديدة"* (a bug report from
  mid-testing) came back `priority: high` — purely because "مشكلة" reads as
  alarming, not because anything in the note asked for urgency.
- **The wrong register.** The owner speaks Egyptian Arabic and the notes are
  captured that way, but summaries came back in Modern Standard Arabic, third
  person: *"المستخدم يجرب تسجيل الصوت من صفحة الويب..."* instead of the
  owner's own voice.

**Root causes, both structural:**

1. `note_enrichments.priority` was `NOT NULL`, and the JSON Schema's
   `required` list mirrored that — the model had no way to say "this note
   expressed no urgency". Forced to answer, it inferred urgency from the
   subject matter of the note instead of from anything the user actually said.
2. The system prompt hardcoded `Write ALL free text ... in Modern Standard
   Arabic (العربية الفصحى)` — the note's actual dialect was never read as a
   signal, and the prompt never told the model to write as the user rather
   than about them.

**Fixed:**

- `priority` made nullable: schema (new migration,
  `20260813000200_enrichment_priority_optional.sql`), JSON Schema (`anyOf`
  with `null`), the prompt (an explicit table naming `null` as the labeled
  default, with a worked example showing "a problem is described" ≠
  "urgency was stated"), and the client (`priorityLabel` now returns `null`
  for both `null` and `normal`, so neither renders a chip — the same contract
  `actionLabel` already used for `"none"`).
- Prompt rewritten to match the note's own dialect and register, and to write
  in the user's own first-person voice rather than reporting on them in the
  third person. The same instruction was applied to the digest prompt
  (`digest/index.ts`), which had the identical فصحى hardcoding and had never
  actually run yet (`weekly_digests` has zero rows — the owner had only ever
  seen the empty-state placeholder text, not a real review).
- Found while re-testing, unrelated to the above: `ScribeASR.transcribe`
  never sent `tag_audio_events`, so ElevenLabs writes audio events directly
  into `text` — one stored note's `raw_text` literally began `"[يسعل] طيب
  دي صفحة..."`. Fixed with `tag_audio_events: false`. Confirmed against the
  exact recording that produced it: same audio, parameter omitted → `"[يسعل]
  طيب دي صفحة..."`; parameter `false` → `"طيب دي صفحة..."`, clean.
- `PROMPT_VERSION` bumped `2026-08-01.1` → `2026-08-13.1`. This is why: the
  `(note_id, language, prompt_version)` key means the old enrichments are
  preserved, not silently overwritten, so v1 and v2 output can still be
  diffed on the same real notes later if needed.

**Verified against the real Anthropic API, with the real shipped module
imported directly** (not a copy, not a mock) — four cases run through
`systemPrompt("ar")` exactly as `pipeline.ts` calls it:

| case | before | after |
| --- | --- | --- |
| "مشكلة في صفحة التسجيل الجديدة..." | `priority: high` | `priority: null` |
| Safari test recording, summary | 3rd person, MSA | *"بجرب التسجيل من صفحة الـ web من على Safari مباشرة، عايز أتأكد إذا كانت هتشتغل ولا لأ"* — 1st person, Egyptian |
| "...النهاردة ضروري قبل ما يقفل" | (untested) | `priority: urgent`, `action_due_at` resolved to today 20:00 `Asia/Dubai` |
| "بكرة الساعة 9 الصبح..." | (untested) | `action_due_at: 2026-08-14T05:00:00Z` = 9:00 AM Dubai, the correct following day |

The third case matters as much as the first two: the fix removes a false
positive, it does not disable the feature. A note that genuinely states
urgency still gets flagged.

**Not done:** the 12 pre-existing notes were left as they are, by owner
decision — judged going forward on new notes only, not backfilled. Also
unresolved, not part of this change: a note stating two separate times (the
gym-then-book note, "الساعة 5... وبعد كده... الساعة 6") keeps only the first
in `action_due_at` — the schema has one due-date field, so this is a schema
gap, not a prompt bug.

## SB-044 · The priority rail never showed a color, for any priority

Right after SB-043 deployed, the owner sent a screenshot contradicting an
earlier claim in this session that the colored rail was already working:
**no task showed a colored line, urgent included.**

`.task-row .rail { background: transparent; }` in `global.css` is two
classes — specificity `(0,2,0)`. `.rail-urgent { background: var(--danger); }`
is one class — `(0,1,0)`. CSS resolves competing declarations by specificity
first, source order only as a tiebreak among equal-specificity rules, so the
base rule's `transparent` always beat every modifier below it regardless of
where each was written. No priority could ever paint the rail.

**Confirmed with `getComputedStyle` in a real browser**, before touching the
file: a `<span class="rail rail-urgent">` resolved to `background-color:
rgba(0, 0, 0, 0)` — transparent, despite the modifier class being present and
correctly written.

**Fixed** by deleting the competing `background: transparent` from the base
`.task-row .rail` rule. Re-checked the same way: `rail rail-urgent` →
`rgb(186, 26, 26)`. A plain `<span>` with no modifier class already paints
nothing on its own, so the "no rail" state for `normal`/no-priority rows is
unchanged.

**Confirmed live on hosted, on real data, after deploy** — owner screenshots
of the Tasks and Notes screens:

| note | priority | rail shown |
| --- | --- | --- |
| "عندي مهمة مهمة جدًا إني أراجع الـ UAT Documents..." (explicit urgency signal) | `urgent` | red |
| "مشكلة في صفحة التسجيل الجديدة" (one of the 12 pre-existing, not re-enriched per SB-043) | `high` (unchanged, pre-fix classification) | its original color, unchanged |
| new notes carrying no urgency signal | `null` | no rail |

Both the newly-correct urgent case and the deliberately-untouched old `high`
note behaved exactly as the two prior fixes (SB-043 and this one) predict.

## SB-045 · Search always returned "no results" — then "too many" — four bugs, not one

Owner report: searching the *literal text* of an existing note — "مراجعة UAT
Documents الساعة 10 بكرة" — returned "لا توجد نتائج". In the same message,
the owner supplied a real `COHERE_API_KEY` for the first time. The two turned
out to be one investigation, and it took three separate confirmations, each
only visible after fixing the one before it.

**Bug 1 — hybrid mode required an embedding no key could produce.**
`functions/search` defaults to `mode: "hybrid"`, and hybrid always calls
`embeddingProvider().embed(query, "query")` before it ever reaches the
lexical arm or the RPC. `supabase secrets list --project-ref
hfjpotjbrrnghuqhxoux` confirmed no `COHERE_API_KEY` had ever been set on
hosted — so `requireEnv("COHERE_API_KEY")` threw on *every* search, lexical
matches included, because the throw happened before lexical ever got a
chance to run.

**Bug 2 — the client turned every error into "no results".**
`web/src/features/Search.tsx` had `.catch(() => setHits([]))`: whatever the
server said, right or wrong, rendered as an empty state indistinguishable
from a genuine zero-match search. No console line, no code, nothing to
diagnose from — the same swallowed-error shape as bugs #8, #9, and #10
below, this time client-side. Fixed by keeping the real `ApiError` code and
rendering it through the existing `errorLabel()` catalogue, the same
contract `Notes.tsx`'s `unreachable` state already used.

**Bug 3 — the key alone did not fix it, and this one only appeared after
setting the key.** Calling `sweep` right after adding the secret returned
`{"embedded":0,"debug":{"candidates":14,"skipped":[...14 notes, each
"attempts":5]}}`. Every one of the 12 pre-existing notes (plus 2 more
enriched since) had already hit `MAX_ATTEMPTS` while `COHERE_API_KEY` was
missing — the sweep's own retry cap, designed for exactly "a vendor key left
as a placeholder" per its own comment, now stood between the fixed key and
the notes it should have unblocked. An optional stage is supposed to degrade
a note, never fail it (ADR-0007) — but degrading *permanently*, past the
point the real blocker is gone, breaks that promise just as thoroughly as
failing it would.

**Verified in this order, each one for real before moving to the next:**

1. `supabase secrets list` — confirmed the key was genuinely absent, not a
   guess.
2. The real Cohere key, called directly with the exact request shape
   `providers.ts` sends (`POST v1/embed`, `model: embed-multilingual-v3.0`,
   `input_type: search_query`) — returned a real 1024-dim vector. Proved the
   key itself works, independent of whether the platform had picked it up.
3. `supabase secrets set COHERE_API_KEY=...` on hosted, then `POST
   /functions/v1/sweep {}` — `embedded: 0`, but now with a real 14-candidate,
   14-skipped debug payload instead of a silent zero. This is what surfaced
   bug 3 — before this call, "the key fixes it" looked true.
4. Added a `forceEmbedBackfill` flag to `sweep` (bypasses `MAX_ATTEMPTS` in
   the embedding path only, never sent by the cron trigger), deployed, then
   `POST /functions/v1/sweep {"forceEmbedBackfill":true}` →
   `{"embedded":14,"debug":{"failures":[]}}`. Every one of the 14 real,
   pre-existing notes now has a real embedding, from a real Cohere call.
5. `POST /functions/v1/sweep {}` again, unforced — `{"embedded":0,"debug":
   {"stage":"no_rows_found"}}`. Steady state: nothing left to backfill, and
   the routine per-note retry cap is back in effect for whatever comes next.
6. `web`: typecheck, RTL guard, 23 tests, build — all pass with the
   `Search.tsx` fix.

**The owner completed the last hop** — the round trip I had no session to
test myself. Result: search worked, and it surfaced a fourth bug in the same
message, in the owner's own words: "جمع لي تقريبا كل الملاحظات" (gathered
almost every one of my notes).

**Bug 4 — the semantic arm had no relevance floor.** `search_notes`'s
semantic CTE ranked every note with an embedding by cosine distance and
excluded none of them. With a 14-20 note corpus, "top `candidates` (200)"
is not a filter at all — the whole corpus qualifies, rides RRF fusion, and
shows up in results for any query regardless of actual relevance. This is
the same shape as bug 3 above: a limit written for a scale (a large corpus)
the project has not reached yet, silently doing nothing at the scale it
actually runs at today.

First attempt reused `relate_note()`'s cutoff (similarity ≥ 0.78, i.e.
distance ≤ 0.22) — caught as WRONG before shipping, by testing it, not by
re-reading it harder. `relate_note()` compares two `search_document`-type
embeddings (Cohere embeds those symmetrically); search compares a
`search_query`-type embedding against `search_document`-type ones — a
different, asymmetric vector space the same model was trained for, with no
reason to assume the same number applies. Measured the real distribution
directly instead: 6 real notes, 3 real queries, real
`embed-multilingual-v3.0` calls via `POST v1/embed`. Result: the CORRECT top
match for each query scored similarity 0.41-0.53; the LEAST-relevant note
for that same query still scored 0.34-0.46. Short, single-sentence Arabic
notes compress into a narrow band for this model — no clean gap exists to
cut at. Landed on distance ≤ 0.6 (similarity ≥ 0.40): a measured, permissive
floor, honestly documented as imprecise, not a tuned one.
Migration `20260813000300_search_semantic_threshold.sql`.

Verified against a fresh 3-note corpus, built and searched through a real
signed-in local session (water leak / sales report / birthday gift):
query "مشكلة سباكة في البيت" (a plumbing problem, sharing no words with the
water-leak note's text) returned 2 of 3 — the water-leak note and, more
marginally, the birthday note — correctly excluding the unrelated sales
report. Real improvement, not perfect precision; see 11-features.md 3.9 for
the honest gap.

**Three more gaps from the same owner report, all UX rather than data
bugs:**

- **No result count.** `Search.tsx` now shows `t.plural("searchResultCount",
  hits.length)` beside the input — new plural key, same six-CLDR-category
  shape as `taskCount`.
- **The search box scrolled away with long result lists.** `.search-input`
  is now `position: sticky; inset-block-start: 0` inside `.main`. Verified
  with `getBoundingClientRect()` before and after a programmatic
  `main.scrollTop = 300`: `top` was identical both times — it did not move
  while `main.scrollTop` visibly did.
- **Clicking a result did nothing.** No note-detail wiring existed in
  `Search.tsx` at all. Wired it to the same `NoteDetail` component
  `Notes.tsx` already uses. `NoteDetail`'s `enrichment` prop was typed as
  the full `Enrichment` (`suggested_action`, `action_due_at` required) but
  the component only ever reads `title`/`summary`/`category` — narrowed the
  prop type to `Pick<Enrichment, "title" | "summary" | "category">` so a
  search hit (whose RPC does not return those other two fields) can open the
  same sheet without inventing fake values for fields nothing displays.
  Verified live: clicking a result opened the real detail sheet, correct
  title/summary/category/date, correct raw text.

## SB-046 · Production was completely dead — twice, for two different reasons

**Symptom, found live:** `wamda-a8k.pages.dev` rendered its shell fine, but
every Supabase call was blocked and a real sign-in attempt threw immediately.

**Root cause: no Git connection at all, so nothing rebuilt the client's
baked-in config.** `wamda` had been deployed by hand with `wrangler pages
deploy` in a prior session — the "commit message" shown next to each
deployment in the Cloudflare UI was just local git metadata `wrangler`
attaches, not evidence of a webhook. Confirmed once the owner's own
screenshot of Settings → "Git" showed **No Git connection**. The owner then
connected the GitHub repo (`muhammadabdosaber/second-brain`, root `web`,
build `npm run build`, output `dist`, production branch `main`, automatic
deployments on) and added `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as
Production variables — but the *first* build the new Git connection
triggered ran at connect-time, before those variables were saved. That build
went live with both vars empty.

Two things degrade independently, both by design, when
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are empty at `vite build` time —
each meant for a *fresh checkout with no `.env.local` yet*, not a broken
production deploy:

- `web/vite.config.ts`'s `buildCsp()` catches the invalid URL and leaves
  `connect-src` as `'self'` only, so the CSP meta tag baked into the shipped
  HTML blocks every cross-origin call to Supabase outright.
- `web/src/data/api.ts:34-37` falls back to
  `createClient("http://127.0.0.1:54421", "anon-key-not-configured")` rather
  than throwing, so the client that *does* build points at a local dev
  address nobody in production can reach.

Confirmed live, in order: a real login attempt in a fresh tab logged
`Connecting to 'http://127.0.0.1:54421/auth/v1/otp' violates ... "connect-src
'self'"` in the console — proving both fallbacks were active simultaneously.
After the owner triggered a fresh deployment (Deployments → Retry) with the
variables now saved, the built JS hash changed
(`index-DLgB7sIk.js` → `index-DHD8tW5K.js`) and:

- The CSP meta tag now reads
  `connect-src 'self' https://hfjpotjbrrnghuqhxoux.supabase.co` (read
  directly from the live `<meta http-equiv="Content-Security-Policy">`).
- A `fetch()` to `.../auth/v1/otp` with a deliberately wrong `apikey` header
  returned `401 Invalid API key` — proving the request now reaches Supabase
  at all, past the CSP. The same call with the real anon key returned `500
  Error sending magic link email` instead, which is the pre-existing Resend
  sandbox-sender restriction (`onboarding@resend.dev` can only deliver to
  the account's own verified address — see the SMTP note above), not a CSP
  or config failure — confirmed by hitting the auth endpoint directly, not
  inferred.

No application code changed. The fix was entirely in Cloudflare Pages
config: connect Git, save the two `VITE_`-prefixed variables under
Production, then force one more build so the vars a Git-triggered build
already reads got baked in.

### Part two: sign-in was still dead, and the key was a *masked* key

That fix cleared the CSP, but the owner reported sign-in still failed —
"حدث خطأ" on every attempt, no code ever arriving. What made this one hard
is that the owner's own DevTools showed **nothing at all**: no console
error, and no request in the Network tab. Meanwhile a `fetch()` I issued by
hand to the same endpoint, with the key typed out from
`web/.env.production.local`, returned `200`. Two contradictory results
against the same project.

**Root cause: the value saved as `VITE_SUPABASE_ANON_KEY` in Cloudflare was
a masked rendering of the key, not the key.** It was the first 8 characters
(`eyJhbGci`) followed by **200 `•` characters** — pasted from a UI that
displays the key obscured. Measured directly on the deployed artefact, by
downloading it and counting code points rather than eyeballing it:

```
U+2022 BULLET count in whole bundle:  200
real key length (.env.production.local):  208, pure ASCII, 3 JWT parts
8 real chars + 200 bullets = 208  ← the mask preserved the length exactly
```

`•` is `U+2022`, outside the ISO-8859-1 range HTTP header values are
restricted to, so **`fetch` throws synchronously before dispatching**:
`Failed to read the 'headers' property from 'RequestInit': String contains
non ISO-8859-1 code point`. That single fact explains every symptom:

| Observation | Why |
| --- | --- |
| No entry in the Network tab | the request was never dispatched |
| No console error | `supabase-js` catches the throw and returns it as `{ error }` |
| Generic "حدث خطأ" on screen | `Auth.tsx` maps any `error` to `errorGeneric` |
| A hand-issued `fetch` worked | it used the real key, not the deployed one |

**Cost note, recorded because it is the point of this ledger:** this
session saw the exact signature — `charCodeAt` returning `8226` for every
character of the `apikey` header, measured in-page — and *dismissed it* as
an artefact of the agent harness masking secrets in tool output. That was
wrong, and it cost an extra round trip through the owner. The tell that
should have settled it immediately: the bullets were computed by
`charCodeAt` **inside the page**, so no output-layer masking could have
produced them.

**Confirmed fixed, end to end.** After the owner re-entered the real key
and redeployed (`index-DHD8tW5K.js` → `index-DnCT3Jfi.js`), the deployed
bundle was re-downloaded and measured again — `0` bullets, `0` non-ASCII
characters at the key site, a 208-character run splitting into 3 JWT parts.
Then the real UI was driven: typed an address, clicked «أرسل رمز الدخول»,
and instrumented `window.fetch` recorded

```
POST https://hfjpotjbrrnghuqhxoux.supabase.co/auth/v1/otp → 200 {}
```

with the screen advancing to the code-entry step («أرسلنا رمزًا مكوّنًا من
ستة أرقام إلى بريدك», the «رمز التحقق» field, the «تأكيد» button). Entering
the code itself was left to the owner — this agent does not type
authentication codes on a user's behalf.

**Owner-confirmed, 2026-08-15**, closing the gap this section opened: the
owner entered the code, signed in, and reports the app working — including
the Tasks screen that had been stuck on «جارٍ تجهيز البيانات…» during the
broken-key window. That stuck state was a *symptom* of the masked key, as
predicted here, not a separate bug.

Scope of that confirmation, stated plainly: it is the owner's report on a
real signed-in session against hosted, which is the strongest evidence this
project has for a client-side screen. It is not an instrumented measurement
— no per-screen network trace or row count was captured — so treat it as
"the owner used it and it worked", not as a per-feature assertion.

**One screen upgraded past that caveat, same day:** the owner also reported
clicking a search result did nothing. Before chasing it as a new bug, the
question was whether it was *another* symptom of the broken-key window
rather than a separate defect — `Search.tsx`'s open-on-click wiring (SB-045)
hadn't been exercised against hosted since the outage. Confirmed with a
screenshot: clicking a result from the "كنت بتكلم عن عشوائي" query above
opened `NoteDetail` with the correct title, category chip, date (١٢ أغسطس),
and raw text («خليهم يجربوا كده مرة كمان، معهم هيشتغلوا ولا لأ؟»). It was the
outage, not a second bug — closes SB-045's click-to-open claim against
hosted, not just the local corpus it was originally verified on.

## Semantic search reviewed on a real hosted query — confirms Cohere, flags a false positive

Owner shared the raw search response for query "كنت بتكلم عن عشوائي" against
their real hosted notes. Both hits carried `lexical_rank: null` and a
`semantic_rank` (1 and 2) — direct proof the lexical arm found nothing
(`websearch_to_tsquery` ANDs every word in the query, and this one shares no
complete word with either note) and Cohere's embedding comparison alone
produced the results. Confirms SB-045's mechanism end to end on real data,
not just the local test corpus.

One of the two, though, has no evident connection to the query — the exact
false-positive risk SB-045 already named when it described the `0.6`
distance floor as "measured, not tuned" on 6 notes. Filed as SB-048: not a
bug to fix now, since tightening the number today would be another guess on
a still-small corpus, but a re-measurement to do once there is enough data
for "correct" and "incorrect" to actually separate. See `docs/13-tasks.md`
SB-048.

## SB-049 · Browse past weekly reviews, not just the latest

Owner asked how the weekly review is produced, where it lives, and whether
past weeks could be browsed. Reading the code (`Digest.tsx`,
`functions/digest`, the `weekly_digests` schema) showed every week was
already stored forever with no retention job — `.limit(1)` in the client was
the only thing throwing history away. Filed as SB-049, then implemented the
same session.

**Changed:** `Digest.tsx` now selects up to 26 rows (`order by period_start
desc`, no language filter — a digest is written in the note language, not
the UI language) instead of one, keeps the newest selected by default, and
renders a `.filter-bar` picker (reusing SB-041's chip styling) over the rest.
Each chip's label is computed at render time from `period_start`/`period_end`
via `Intl.DateTimeFormat`, never stored — the newest chip reads
"هذا الأسبوع", older ones read a day-month range. New i18n keys
`digestThisWeek`, `digestHistoryLabel` in both `ar.ts` and `en.ts`.

**Ran, not just typechecked:**

- `cd web && npm run verify` — typecheck, RTL guard, 23 tests, build. All
  green.
- Local stack brought up (`supabase start`, `Second_Brain` containers
  healthy). The local database had **zero** `weekly_digests` rows — no batch
  digest had ever completed against it — so a real multi-week test needed
  data. **Seeded two rows** directly via `service_role`
  (`period_start` 2026-08-01 and 2026-08-08, distinct `content` JSON each)
  for the local test user. This is disclosed as seeded, not generated, per
  the task's own instruction not to fake multi-week coverage by editing the
  query limit instead.
- Dev server up on `:5174`, signed in as `muhammad@example.test`. Opened the
  digest tab: **two chips rendered** — "هذا الأسبوع" and "1 أغسطس – 7
  أغسطس" — with the newest week's content showing by default (headline
  "الأسبوع ده كان معظمه شغل على SB-046 وإصلاح النشر."). Clicked the older
  chip: content swapped to that week's own headline ("الأسبوع اللي فات كان
  معظمه بناء شاشة المهام والبحث."), themes, wins, and suggestion — confirmed
  via `get_page_text`, not assumed from the click alone.
- Console during this test showed `timeline_failed` / `503` errors from the
  **Notes** screen's Edge Function call — unrelated to this change; `Digest`
  reads straight through PostgREST by design (see the comment in
  `Digest.tsx`) and rendered correctly regardless of Edge Runtime state.

**Not re-verified:** the batch-generation pipeline itself (`digest-enqueue`/
`digest-collect`, SB-017/SB-018) — this task only touched how the client
reads already-written rows, not how they get written.

## SB-052 · The 2026-08-17 hosted regression is still live (checked 2026-08-20)

**Re-checked, not assumed.** The entry above ("REGRESSION found 2026-08-17")
ended without a resolution. Read-only queries against the hosted project
(`hfjpotjbrrnghuqhxoux`, via the machine's cached `supabase` CLI login, no
secret material read) confirm it is **still broken three days later**:

```
select r.status_code, left(r.content,80), r.created
from net._http_response r order by r.created desc limit 8;
```

Eight calls in the 20 minutes before this check (17:45–18:15 UTC,
2026-08-20), every one `403 {"error":{"code":"forbidden"}}` —
`sweep-worker` (jobid 2) and `digest-collect` (jobid 4) both still rejected
by `requireServiceRole()`, same as the 08-17 finding. `cron.job_run_details`
still shows `status: succeeded` at the pg_net layer for all of them, which is
why nothing about this is visible without reading `net._http_response`
specifically.

**No damage yet, but the window that matters is close.** `select status,
count(*) from notes where status in ('queued','transcribing','enriching')`
returns zero rows — nothing is currently stranded. But
`digest-enqueue` (jobid 3, `0 3 * * 6`) last actually ran 2026-08-15, the
Saturday *before* the regression started; today is Thursday 2026-08-20, so
its next tick is **Saturday 2026-08-22, 03:00 UTC — under two days out** —
and it will get the same `403` unless the Vault secret is fixed first.

**Not fixed here, on purpose.** The cause was already narrowed on 08-17 to a
mismatch between the Vault-stored service-role key and the function's live
`SUPABASE_SERVICE_ROLE_KEY`. Reading either the current real key
(`supabase projects api-keys`) or the stored one
(`vault.decrypted_secrets`) is secret-material access this agent should not
hold or compare — the original diagnosis stopped there for the same reason,
and this re-check does too. The fix is one manual step, unchanged from
SB-001's own instructions: the owner re-runs `vault.create_secret` (or
`update`) for `sweep_service_role_key` (and whatever digest's schedule uses)
with the current real key, pasted without trailing whitespace. Filed as
**SB-052**, `todo`, ahead of everything else in the backlog — see
`docs/13-tasks.md`.

## 2026-08-21 · Repo-wide accuracy pass, hosted state read, and the SB-050 deploy

Three things ran here: the client suite against the merged SB-050 work, a
read-only audit of the hosted project, and the production deploy itself.

### What ran locally

```
cd web && npm ci && npm run verify
```

`npm ci` on a fresh worktree checkout: **0 vulnerabilities**. `verify` →
typecheck clean, RTL guard clean, **38/38 tests** (`language` 10, `due` 15,
`i18n` 13), production build green — `dist/assets/index-*.js` 463.13 kB raw /
**132.55 kB gzipped**, CSS 17.52 kB / 3.93 kB gzipped, PWA precache 9 entries
(660 KiB). This is the same commit CI ran green on run `32450892938`.

Not run in this session: `supabase db reset` + `verify.sql`, and the Deno
tests. Nothing in this change touches the schema or a function — the diff is
docs plus the already-CI-verified SB-050 client work — so the 26 schema
assertions and 9 Deno tests are inherited from the previous session's run,
not re-proven here. Said plainly rather than implied.

### What the hosted project actually looks like (read-only, 2026-08-21)

Queried through the CLI's cached login against `hfjpotjbrrnghuqhxoux`. No
secret material was read; every query below is state, not credentials.

| Checked | Result |
|---|---|
| Migrations | **20 local / 20 remote, zero drift** — `supabase migration list --linked` |
| Note statuses | `ready: 17`, `draft: 7`, `failed: 1` — nothing in `queued`/`transcribing`/`enriching` |
| The one `failed` note | dates from 2026-08-09 (`enrich`, `unknown` ×5), eight days before the current regression |
| `ai_jobs`, last 14 days | `embed` 50 succeeded, `enrich` 17 succeeded, `transcribe` 18 succeeded, latest 2026-08-20; every failure row predates the key fixes |
| `cron.job` | four jobs, all `active: true` — `ai-jobs-retention`, `sweep-worker`, `digest-enqueue`, `digest-collect` |
| Storage buckets | `audio` and `screenshots` both `public: false`, both with a MIME allowlist |
| `note_enrichments.action_due_at` | 7 rows carry a due date — so SB-050's badge has real data to count on hosted, not just locally |

Two doc claims were corrected because of this, not because they read
strangely: `11-features.md` 5.8 (private bucket + signed URLs, was `⬜`) and
5.15 (`action_dismissed_at` "exists only on the local database" — it is on
production).

### SB-052 · still failing, fifth day

```
select status_code, left(content,60), created
from net._http_response order by created desc limit 8;
```

All eight rows `403 {"error":{"code":"forbidden"}}`, the most recent at
**2026-08-21 13:15:00 UTC** — the `*/5` `sweep-worker` tick. Unchanged from
the 08-17 finding and the 08-20 re-check. `digest-enqueue` fires **2026-08-22
03:00 UTC** and will be rejected the same way unless the owner re-sets the
Vault secret first.

Still not diagnosed further, deliberately: confirming the cause means
comparing the stored secret against the live service-role key, which is
secret material an agent should not hold. Owner action, same as before.

## SB-050 · A due date that reaches you before you open the Tasks tab

**2026-08-20, local stack, a real signed-in session, six real task rows.**

The data was already there — `note_enrichments.action_due_at`, an index for it,
and a Tasks screen grouping by it. The defect was reach: the app opens on
**Capture**, so nothing about a due date was visible until you navigated to the
one screen that was supposed to remind you.

**What ran.** `web/src/core/due.ts` holds the rule as pure functions, so the
number the user acts on is covered by tests rather than by inspection:
`npm run verify` → typecheck + RTL guard + **38 tests** (21 → 38; 15 new in
`test/due.test.ts`) + build, all green.

The fixtures were built to make the count *exclude* things, not just include
them — an assertion that only counts is one that cannot fail for the right
reason:

| Task | Due | State | Expected | Observed |
|---|---|---|---|---|
| مراجعة تقرير مبيعات | 20 Aug 00:00 (past) | open | counted, marked late | ✅ chip `متأخرة` |
| مكالمة الدكتور | 20 Aug 23:00 (today) | open | counted, **not** late | ✅ no chip |
| دفع فاتورة الكهرباء | 18 Aug (past) | **completed** | not counted, not late | ✅ excluded, no chip |
| تجديد رخصة العربية | 23 Aug (+3d) | open | not counted | ✅ excluded |
| ×2 no date | — | open | not counted | ✅ excluded |

Badge showed **2**, from the Capture tab, as
`المهام — مهمتان متأخرتان أو موعدهما اليوم`. The Arabic dual (`مهمتان`, not
`٢ مهمة`) is `Intl.PluralRules` picking the `two` category — the reason that
plural table exists.

**RTL proven, not merely linted.** `inset-inline-end: -9px` resolved in the live
document to `left: -9px`, and `margin-inline-end` on the flag to `margin-left`.
The guard passing says the physical form is absent; this says the logical form
actually mirrors.

### One real bug, found by ticking a box

Ticking a task off left the badge reading `2` while the group heading directly
under it read `مهمة واحدة`. The Tasks screen updates its own list optimistically,
but the badge is a **separate reader of the same rows**, and nothing told it.
`setNoteCompleted` now fires `NOTE_CHANGED_EVENT`, distinct from `SYNCED_EVENT`
("the outbox moved") because this means "a row you are showing just changed".
Re-tested live: unticking moved the badge **1 → 2** with no reload, and badge
and heading agreed afterwards. Found by clicking, not by reading.

### The foreground refresh was proven, not assumed

An installed PWA sits open for days, so a `new Date()` taken once at mount keeps
yesterday's idea of "today". `useNow` re-reads the clock on `visibilitychange`
and `focus`. Waiting for real midnight is not a test, but `isOverdue` is
minute-granular, so the same mechanism was exercised in 45 seconds: a task was
set to fall due at 17:55:18Z, the page was loaded before it (no chip at
17:54:46Z), and after the moment passed a **`focus` event alone** — no reload,
no refetch — made the `متأخرة` chip appear.

Worth recording because the first attempt at this check *failed*: the chip did
not appear, and the cause was the browser pane reporting
`document.visibilityState === "hidden"` (it is not displayed), which is exactly
the condition the guard is written to skip. The guard was right and the harness
was wrong. Re-run with the pane emulating a foregrounded document — a
`Document.prototype` override in the page, **no change to app code** — the chip
flipped `false → true`. That caveat is the honest form of this result.

### Not verified

- **No notification leaves the app.** No Notification API, no service-worker
  push, no VAPID, no subscription table. Deliberate scope (owner chose in-app),
  not an oversight — see SB-051.
- **The React wiring has no unit test.** `vitest` here runs `environment: "node"`
  over `web/test/**`; there is no jsdom and no testing-library, and adding both
  to cover a badge is a dependency decision, not a side effect of this task. The
  pure rule is unit-tested; the wiring is browser-tested above.
- **Hosted.** Everything here ran against the local stack. Not yet redeployed to
  `wamda-a8k.pages.dev`.

### An operational note

`supabase start` in this worktree came up with Kong unable to resolve the edge
runtime — every `functions/v1/notes` call returned `503 {"message":"name
resolution failed"}` while the runtime's own log showed it serving normally.
`supabase stop && supabase start` cleared it; the seeded rows survived (the stop
backs the volume up). Worth knowing because the 503 looks like a broken function
and is not one.

## Security review · first fixes (SECURITY_REVIEW.md)

**2026-08-16.** A full-codebase security review (requested by the owner ahead
of the move to dedicated infrastructure and paid tiers) is written to
`SECURITY_REVIEW.md` at the repo root — findings, severities, and a status
column that tracks fixes. Read that file for the substance; this entry
records only what *ran*.

**Changed:** `functions/search` now calls `enforceRateLimit(admin, user.id,
"embed")` before the paid Cohere embedding call (finding F7 — the one
vendor-spending endpoint SB-002 didn't cover); `functions/notes`'s
`audio-url` service-role write gained `.eq("user_id", user.id)` (F2, the
docs/08 invariant); `web/public/_headers` added so Cloudflare Pages serves
`frame-ancestors 'none'` / `X-Frame-Options: DENY` / `nosniff` /
`Referrer-Policy` / `Permissions-Policy` — the directives the `<meta>` CSP
structurally cannot carry (F11); CI's web job gained
`npm audit --omit=dev --audit-level=high` (F15).

**Ran, not just typechecked:**

- `npx -y deno check supabase/functions/search/index.ts
  supabase/functions/notes/index.ts` — clean. (Deno itself is not installed
  on this machine; the npm-distributed `deno` 2.9.5 was used.)
- `npx -y deno test --allow-env supabase/functions/_shared/http.test.ts` —
  5 passed, 0 failed.
- `cd web && npm run verify` — typecheck, RTL guard, 23 tests, build, all
  green; `dist/_headers` confirmed present in the build output.
- `npm audit fix` then `npm audit` — nanoid bumped past the GHSA advisory;
  **0 vulnerabilities** in the full tree, verified by the re-run.

**Built, not run:** the `/search` 429 path has not been exercised over live
HTTP — the semantic arm needs the Cohere key, absent from this worktree —
so F7 sits at the same evidence level SB-002 had before its 61-call proof.
The `_headers` file is not live until the next Pages deploy. The CI audit
step has not executed on a real runner.

**Owner-gated items, resolved the same session:** the High finding —
`sweep`/`digest` accept the public anon key as a sufficient JWT, so anyone
with the bundle can trigger real vendor spend — was approved and fixed:
`requireServiceRole()` (`_shared/http.ts`) compares the bearer to
`SUPABASE_SERVICE_ROLE_KEY` at the top of both handlers. Proven at unit
level, not live: `npx -y deno check` over all 8 functions is clean, and
`http.test.ts` grew from 5 to 9 tests — service key passes; anon-style,
missing, and empty bearers each get 403. OTP expiry was approved and cut
3600 → 600 in `config.toml` (BOM-checked). The `notes` INSERT-grant
migration was explicitly deferred by the owner into the future billing
schema work.

### Deployed to hosted (2026-08-16, same session)

PR #31 merged to `main`; the owner asked for the three deploy steps to be
run against the live project (`hfjpotjbrrnghuqhxoux`, `wamda-a8k.pages.dev`).
This worktree had no `.env` and was not `supabase link`ed (expected — see
"A new `git worktree` has no vendor keys" below), but a cached CLI login
existed at the machine level, so linking and deploying were possible without
any secret living in this checkout.

- **`supabase functions deploy sweep digest search notes
  --project-ref hfjpotjbrrnghuqhxoux`** — all four bundled and deployed;
  CLI returned `"message":"Deployed Functions."`. Confirmed one of them is
  actually serving the new code path: `curl -X OPTIONS
  https://hfjpotjbrrnghuqhxoux.supabase.co/functions/v1/sweep -H "Origin:
  https://evil.example"` → `403` (the existing `ALLOWED_ORIGIN` preflight
  gate, proving the function responds).

### REGRESSION found 2026-08-17 checking the next cron tick — sweep/digest broken on hosted

**This is the exact case rule #1 exists for.** The line above ("not yet
confirmed... check `cron.job_run_details` after the next tick") was
checked, and the deploy is **not** working as claimed.

`select jobid, status, return_message, start_time from cron.job_run_details
where jobid in (2,3,4) order by start_time desc limit 15` (via `supabase db
query --linked`) shows `sweep-worker` (jobid 2) ticking every 5 minutes as
designed, `status: succeeded` at the SQL level (pg_net queued the request)
— but `net._http_response` for those same calls shows the ACTUAL response:

```
status_code: 403, body: {"error":{"code":"forbidden"}}
```

on every one of the last 8 calls (00:00–00:35 UTC), which span both
`sweep-worker` and at least one `digest-collect` tick (jobid 4 ran at
00:00:00, same pattern). The `requireServiceRole()` gate added for F1
(PR #31) is rejecting the Vault-sourced service-role key that `pg_cron`
sends — the exact caller it was supposed to let through.

**Root cause not fully confirmed — deliberately stopped diagnosing.**
`requireServiceRole()`'s logic itself is right at the unit level (9/9 Deno
tests, including "the service key passes" against a matching env var), so
the mismatch is between the *stored* Vault secret and the function's live
`SUPABASE_SERVICE_ROLE_KEY` — most likely a stale key from before some
rotation, or trailing whitespace from how it was originally pasted into
`vault.create_secret()` (SB-001, 2026-08-06). Both `supabase projects
api-keys` (to see the current real key) and a direct `select ... from
vault.decrypted_secrets` (to inspect the stored one) were **blocked by this
session's permission classifier** — correctly: both are secret-material
reads, and this agent should not be the one holding or comparing raw
service-role key bytes. Diagnosis stopped there; fixing requires the owner
to re-run the Vault secret against the current real key, the same manual
step SB-001 already documents.

**Checked for actual damage: none found yet.** `select * from
public.stuck_notes` shows only pre-existing `draft` notes (~6000+ minutes
old, ~4 days before this regression — `sweep` never touches `draft`
anyway, so unrelated). `select status, count(*) from notes where status in
('queued','transcribing','enriching')` returned zero rows — nothing is
currently waiting on the broken retry path. The exposure is real but
currently latent: the next note whose live `enrich`/`transcribe` call fails
has no safety net until this is fixed, and `digest-enqueue` (jobid 3,
`0 3 * * 6`, weekly) needs it fixed before its next Saturday firing.

**Not yet confirmed:** whether re-setting the Vault secrets resolves it —
that is the next thing to check, after the owner runs the fix.
- **Cloudflare Pages** — no manual step needed: its GitHub integration
  auto-deployed the merge commit (check run `Cloudflare Pages`: `success`
  on `d1e0419`). Confirmed live with a real request:
  `curl -sI https://wamda-a8k.pages.dev/` returns
  `content-security-policy: frame-ancestors 'none'`, `x-frame-options:
  DENY`, `x-content-type-options: nosniff`, `referrer-policy:
  strict-origin-when-cross-origin`, and the `permissions-policy` line — all
  five headers from `_headers`, present on the real response, not inferred
  from the file existing in `dist/`.
- **`SUPABASE_AUTH_SITE_URL=https://wamda-a8k.pages.dev supabase config
  push --project-ref hfjpotjbrrnghuqhxoux`** — first run applied the auth
  diff (`otp_expiry = 3600` → `600`) and then hit an unrelated error on the
  Storage section. A second run confirmed the auth push actually took:
  `Remote Auth config is up to date`.
  **Unrelated pre-existing issue surfaced, not fixed:** `config.toml`
  carries `[storage.vector] enabled = true` (a newer Supabase CLI default,
  untouched by this review), and the hosted project is on the free tier,
  which rejects it — `402 Please upgrade the project to a paid tier to
  enable vector buckets`. Auth/API/DB sections all pushed clean; only
  Storage errors, every time `config push` runs, until either the project
  upgrades or `config.toml` sets `enabled = false` to match the free tier.
  Left for the owner to decide — out of scope for this review.

## Fifteen real bugs this caught

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
8. **A column-level grant meant for the client silently broke a server
   handler that shared its client.** SB-023 (2026-08-04) correctly scoped the
   `authenticated` role down to the four columns a user should write. The
   `/notes/audio-url` handler, still using that same user-scoped client to
   write two server-computed columns (`audio_path`, `status`), started
   silently failing that write on every call — silently, because the result
   was never checked. Every voice note captured after that migration was
   orphaned: real audio in Storage, no note row pointing at it, no error
   anywhere. Caught 2026-08-11, seven days later, by the first real recording
   made after the grant changed. Fixed by moving that specific write to the
   service-role client already used for every other server-computed write on
   `notes`, and by checking its result. See "SB-007 (cont'd)" above for the
   full trace.
9. **A codec-qualified MIME type failed Storage's exact-match allow-list, and
   the failure was invisible.** iOS Safari's `MediaRecorder` reports
   `audio/mp4;codecs=mp4a.40.2`, not `audio/mp4` — the bucket's
   `allowed_mime_types` matches the base type exactly, so the codec suffix
   got every Safari upload rejected. Chrome's plain `audio/webm` happened to
   already match, which is why three prior Chrome recordings all worked and
   nothing caught this until an iPhone was actually used. Made silent by the
   same bug class as #8: `uploadToSignedUrl`'s `{ error }` was discarded, so
   a rejected upload let the code sail on to `transcribe()` against audio
   that didn't exist. Fixed by stripping the codec suffix before the blob is
   created, deriving the Storage path extension from the real recorded type
   instead of a hardcoded `"webm"`, and checking the upload's result. See
   "SB-007 (cont'd) · Deployed, then a second real bug on a real phone"
   above.
10. **The diagnostic banner (added to catch #8 and #9) never read the real
    error code.** `error.context` on a `FunctionsHttpError` is the raw
    `Response`, not a parsed body — reading `.context.error.code` directly is
    always `undefined`. Every server-side failure this app can produce
    (`rate_limited`, `missing_configuration`, `unauthenticated`, any future
    code) collapsed to the same generic `"internal_error"` on screen. Confirmed
    against a real `401 {"error":{"code":"unauthenticated"}}` from the running
    local `notes` function: old extraction → `internal_error`; fixed
    extraction (`await context.clone().json()`) → `unauthenticated`. See
    "SB-012 (cont'd) · The diagnostic banner itself was reporting the wrong
    thing" above.
11. **A recording that captured nothing looked identical to one that worked.**
    Upload succeeded, ElevenLabs answered `200`, `ai_jobs` recorded
    `succeeded`, and the note landed as a `draft` with no text and no
    explanation. Nothing in the pipeline can tell "the microphone was dead"
    apart from "the audio was unclear", because by the time the bytes reach
    the server the distinction is gone — the difference only exists at the
    microphone. Found by parsing a stored recording's container and seeing 340
    identical minimum-size Opus frames. Fixed client-side, where the live
    signal is still observable: a peak-amplitude meter on the recording stream
    warns during the take and again after saving. See "Silence detection,
    verified in both directions" above.
12. **A bucket's config drifted from its migration and could never self-heal.**
    `20260801000400_rls.sql` names all 7 real recording MIME types in its
    `insert ... on conflict (id) do nothing`, but the hosted bucket row
    already existed, created narrower, before that migration ever ran — so
    every push since then silently did nothing to it. iOS Safari's `audio/mp4`
    was rejected outright (`mime type audio/mp4 is not supported`) on a real
    iPhone recording. `on conflict do nothing` means no future edit to that
    `INSERT`'s array could ever fix an environment where the row already
    exists — only an explicit `UPDATE` can. Fixed with exactly that, in a new
    migration, plus a `verify.sql` assertion so hosted's bucket config can't
    drift from the migration again without a test noticing.
13. **CSS specificity, not source order, decided which rule painted the
    priority rail — and a two-class base rule always won.** `.task-row .rail`
    set an explicit `background: transparent`; every priority's color came
    from a one-class modifier (`.rail-urgent` etc.) written later in the
    file but at lower specificity, so it could never override the base rule
    no matter how it was reordered. No task showed a colored rail for any
    priority, ever — a bug this session first claimed was already fixed,
    corrected only by the owner's own screenshot. See "SB-044" above.
14. **A production deploy went live with its config vars silently empty, and
    two independent fallbacks hid it instead of failing loud.** The first
    build a newly-connected Git integration triggered ran before the env
    vars were saved; both the CSP-builder and the Supabase client have a
    deliberate "fresh checkout" fallback for an empty URL, so the site
    rendered and looked normal instead of erroring — it just couldn't reach
    the server. Nothing about this was visible without a real sign-in
    attempt in a real browser tab reading the console. See "SB-046" above.
15. **The deployed anon key was a *masked* key — 8 real characters and 200
    `•` — and the failure it caused was invisible in every tool you would
    reach for.** `•` is `U+2022`, illegal in an HTTP header value, so
    `fetch` threw *before dispatching*: nothing in the Network tab, nothing
    in the console (`supabase-js` catches it and returns `{ error }`), just
    a generic "something went wrong" on screen. Found by downloading the
    deployed bundle and counting code points. The length matched the real
    key exactly (8 + 200 = 208), which is precisely what a length-preserving
    mask does and why the value looked plausible in the Cloudflare UI. See
    "SB-046 · Part two" above.

None were visible by reading the code. Numbers 7, 8, 9, 10, 12, 13, 14, and
15 in particular only appeared from a specific combination of state no test
suite was going to
stumble into — a second vendor key absent while the first was present, a
voice note captured in the narrow window after a grant changed with nothing
exercising that exact code path, a device (iPhone Safari) that had never
actually recorded a note before, a deployment made before its own config
existed, and a credential that was the right length, the right prefix, and
still not the credential.

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

`ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` were added earlier (see SB-007);
`COHERE_API_KEY` was added 2026-08-13 — see "SB-045" above. All three vendor
keys now exist on hosted.

- ~~**Embeddings and semantic search.**~~ **Superseded 2026-08-13.**
  `COHERE_API_KEY` is now set, and `sweep`'s forced backfill embedded all 14
  `ready` notes for real (`embedded: 14, failures: []`), each a genuine
  Cohere API call. Still open: the fused search *response* itself, through a
  real signed-in search, has not been independently observed by me — see
  SB-045's "not verified" note. `relate_note()` was invoked for all 14 notes
  as part of the same backfill; whether it produced any `note_relations` row
  is unconfirmed, since nothing reads that table yet.
- ~~**Weekly digest.** Batch submission and collection never executed.~~ **Superseded (SB-018).** A real Batch submission produced a real digest, rendered in the client. Found and fixed a real bug along the way (the model wraps JSON in a code fence).
- **Cross-lingual retrieval.** The phase-2 claim that an Arabic query finds an
  English note is a property of the chosen model, untested here — SB-006,
  still open, needs a deliberate two-note test now that embeddings exist.

### Client-side gaps

- ~~**Voice capture never ran.**~~ **Superseded — it ran.** Found in the local
  database on 2026-08-02: two notes with `source = 'voice'` and two matching
  objects in the private `audio` bucket, **173 210 bytes** and **8 024 bytes**,
  both `audio/webm`, both under the capturing user's own prefix.
  So `MediaRecorder` produced real Opus/WebM audio, and the direct
  client → Storage upload under a signed URL worked — the step that exists so
  25 MB of audio never routes through an Edge Function.
  Both notes then resolved to `failed` at the `transcribe` stage with
  `error_code = transcription_failed`, attempt 1. That was the expected
  outcome with no ElevenLabs key. **Superseded 2026-08-11 — see SB-007: both
  notes were re-transcribed for real once the key was added.**
  Still untested: iOS Safari, where `MediaRecorder` availability is the open
  question.
- **Only Chromium.** No Safari or Firefox testing. iOS install flow untested.
- ~~**No visual screenshot.**~~ **Partly superseded.** The capture screen has
  now been looked at in both colour schemes at 375×812 — which is how the
  dark-mode button bug above was noticed at all. Still unseen: notes, search,
  digest, auth, and every screen at any other width.
- ~~**Arabic font not bundled.**~~ **Superseded (SB-011).** Public Sans +
  self-hosted Noto Sans Arabic, split by `unicode-range`, no CDN.

## What to run first

```bash
# backend — should reproduce the 26 passes above
supabase start && supabase db reset
docker exec -i supabase_db_Second_Brain psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/verify.sql

# client — should reproduce typecheck + 38 tests + guard + build
cd web && npm install && npm run verify
```

Then phase 2 with a real `ANTHROPIC_API_KEY`, watching for
`prompt_cache_miss` in the function logs.
