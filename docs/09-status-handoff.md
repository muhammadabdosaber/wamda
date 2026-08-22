# 9. Status & Handoff

> **Written to be the first file a fresh session reads.** It records where the
> project actually stands, what is blocking it, and what must not be
> re-litigated. Detail lives in the other docs; this is the map.
>
> Last brought current: 2026-10-21.

---

## ملخّص بالعربي

**اللي خلص:** كل حاجة تقريبًا. قاعدة البيانات، ٨ Edge Functions، تطبيق React
PWA عربي RTL بالكامل، تسجيل دخول برمز، معالجة الذكاء الاصطناعي (Claude
Sonnet 5)، البحث الدلالي (Cohere)، التسجيل الصوتي (ElevenLabs) على آيفون
حقيقي، المراجعة الأسبوعية، والنشر الفعلي على استضافة حقيقية
(`wamda-a8k.pages.dev`) — كل ده اشتغل فعليًا، مش مجرد كود موجود.

**SB-052 اتحل خالص (٢٢ أغسطس ٢٠٢٦).** مهام الـcron كانت بترفض بـ403 من ١٧
أغسطس لأن Supabase غيّرت المفتاح اللي الكود كان بيقارن بيه من غير أي تنبيه.
الحل مش رقعة — الكود بقى بيقارن بسرّ المشروع بيملكه (`CRON_SECRET`)، مش
بمفتاح Supabase بتتحكم فيه هي. اتأكد بتنفيذ حقيقي راجع `200` من الاستضافة.
المراجعة الأسبوعية بتاعة السبت ده فاتت وفشلت قبل الإصلاح — الجاية (٢٩
أغسطس) على المسار المُصلَّح. التفاصيل في SB-052.

**التصميم وصل** (٣ أغسطس ٢٠٢٦) وخلص. القاعدة كانت: **الثيم بس** — وده اتنفذ
من غير ما أي قرار أساسي يتحرك. اقرا `docs/design/README.md` لو هتلمس الواجهة.

---

## Where the project stands

| Layer | State |
|---|---|
| Schema, RLS, RPCs | **Done, verified** — 31 assertions against live Postgres, green in CI |
| Edge Functions (9) | **Done, type-checked, deployed to hosted** — except `push`, built 2026-08-22 and not yet deployed (SB-051) |
| React PWA client | **Done, verified in a browser** — 46 tests, RTL guard, build |
| Auth (email OTP) | **Done, verified end to end**, hosted via custom SMTP |
| AI enrichment | **Done, run for real** — Claude Sonnet 5 (revised from Opus 5, SB-034) |
| Prompt caching | **Measured**, not estimated — $0.0094/call hit vs $0.0220/call miss |
| Embeddings / semantic search | **Done, run for real** (SB-005/045) — 14/14 notes embedded, hybrid search live |
| Voice / transcription | **Done on iOS** (SB-007) — real hosted pipeline, confidence 0.925; Android untested |
| Weekly digest | **Done, run for real** — real Anthropic Batch call, real digest, rendered live in the client |
| Hosted deploy | **Done** (SB-016, 2026-08-09) — `wamda-a8k.pages.dev` |
| Scheduled jobs (sweep/digest/retention) | **Done, fixed and confirmed live 2026-08-22** — SB-052 (was rejected 2026-08-17 → 2026-08-22) |
| Cross-lingual retrieval test | **Not run** (SB-006) — the one M2 exit clause still open, blocking M7 |
| English (phase 2) | Wired, deliberately disabled, gated on SB-006 |

Full evidence ledger: `docs/00-verification.md`.

## SB-052, resolved -- and the pattern behind it, worth remembering

**No longer blocking.** `sweep-worker`/`digest-collect` were rejected with
`403` on hosted from 2026-08-17 to 2026-08-22 because Supabase's own
2026-08-16 API-key migration silently changed what `SUPABASE_SERVICE_ROLE_KEY`
resolves to inside a deployed function, and the code was comparing against
that platform-owned value. Two owner-led Vault updates with a *correct* key
still failed -- proof it wasn't a paste error. A temporary length+hash
diagnostic (never a real secret value) found the actual mismatch: 219 chars
(the real legacy key) vs 41 (what the function actually had).

**Fixed structurally.** `requireServiceRole()` -> `requireCronSecret()`,
comparing against `CRON_SECRET` -- a secret this project generates and owns,
immune to Supabase rotating its own keys again. One more real bug surfaced
finishing this: a `CRON_SECRET` deploy without `--no-verify-jwt` gets
rejected by the platform gateway *before* the function even runs, because
the gateway's own `verify_jwt` expects a real JWT and a random secret isn't
one -- documented directly on `requireCronSecret()` so a plain redeploy
doesn't reintroduce it. **Confirmed live 2026-08-22 12:55 UTC**: a real `200`
with real execution, not an error path. Full trace: SB-052 in
`docs/13-tasks.md`; complete diagnosis in `docs/00-verification.md`.

**Known miss:** this Saturday's `digest-enqueue` tick (2026-08-22 03:00 UTC)
fired before the fix landed and almost certainly failed the same way -- no
weekly digest this week. Next tick, 2026-08-29, is on the fixed path.

**The pattern worth remembering, for the next migration Supabase ships
without warning:** any gate comparing against a platform-managed credential
(`SUPABASE_*`) can break silently the moment Supabase changes what that
credential resolves to, with `cron.job_run_details` reporting `succeeded`
throughout because pg_net only confirms the request was *queued*, never that
it *succeeded* past the target's own auth. If another service-only function
starts silently failing, check `net._http_response.status_code` directly,
not just `cron.job_run_details.status`.

All three vendor keys (`ANTHROPIC_API_KEY`, `COHERE_API_KEY`,
`ELEVENLABS_API_KEY`) are real and working, both locally and on hosted. If a
fresh `git worktree` reports one as missing, that is almost certainly the
worktree's own `supabase/functions/.env` being absent (gitignored by design --
see "A new `git worktree` has no vendor keys" below), not the key having been
lost.

**SB-051 (web push) is built as of 2026-08-22, and deliberately not closed.**
The encryption is asserted against RFC 8291's own worked example byte for
byte, the schema half is proven on a real Postgres, and the client half
builds — but no notification has reached a device, which is the acceptance
line. It needs the owner: mint a VAPID pair, deploy `functions/push`, set two
more Vault secrets (holding `CRON_SECRET`, like `sweep`/`digest`), and
install the PWA on the iPhone. Steps are listed in `docs/13-tasks.md`
"SB-051".

**What genuinely remains:**

- **SB-006 -- cross-lingual retrieval, never run as its own test.** Embeddings
  exist now; nobody has stored one Arabic and one English note about the same
  subject with no shared tokens and queried each in the other language. This
  is the load-bearing assumption behind the whole phase-2 English plan, and
  it is one afternoon of work now that nothing structural blocks it.
- **Android voice capture** -- iOS is proven; Android is not, either direction.
- **`report-to` CSP collector** -- violations are visible only in a browser's
  own DevTools today; no centralized collector exists (`docs/08-security.md`).
- **Safari/Firefox testing** -- only Chromium tooling has been used so far.

## What has been proven, so don't re-derive it

- **Arabic normalization works on real data.** Spelling variants fold; a note
  stored with taa-marbuta is found by a query typed with haa; model-generated
  tags collapse to one slug.
- **RLS isolates users.** Verified independently on `notes`, `note_tags`,
  `note_embeddings`.
- **Offline capture is durable.** Proven in a browser with no server running,
  and pre-auth notes attach correctly to whoever signs in.
- **Logical CSS properties mirror.** `margin-inline-start: 40px` resolves right
  under RTL and left under LTR — measured, not assumed.
- **Arabic plurals are correct** across all four categories that occur.
- **Prompt caching pays.** ~$0.008–0.011 per note measured, below the ~$0.015
  the design estimated.
- **The enum/label split holds end to end** — database stores `task`, UI shows
  مهمة, from real model output.

## What was built and proven

Everything below is now `[x]` — kept as a dated record, not because any of it
is still open. Ordered by consequence, not effort.

- [x] **Sweep worker.** `supabase/functions/sweep` unsticks notes stranded in
      `transcribing`/`enriching` (process died before its own catch ran),
      retries stale `queued` notes, and backfills `note_embeddings` for
      `ready` notes whose embedding stage degraded — via
      `notes_missing_embeddings()` (migration `20260801000700_sweep.sql`).
      Retries are capped at 5 failed attempts per (note, stage), read from
      `ai_jobs`, then the note is marked `failed` rather than retried
      forever. The pipeline logic that both `enrich`/`transcribe` and `sweep`
      call now lives in `_shared/pipeline.ts` — one place, not two copies.
      Verified locally end to end (stuck-note unstick, queued retry with
      grace period, retry-cap-to-`failed`, embedding backfill) against a
      fresh `supabase db reset`; enrichment/embedding calls themselves only
      exercised the failure path, since this worktree has no vendor keys.

      **Scheduled**, as of migration `20260801000800_sweep_schedule.sql`: a
      `pg_cron` job (`sweep-worker`, `*/5 * * * *`) calls it via `pg_net`.
      Neither the project's Edge Functions URL nor the service role key is a
      literal in that file — both are read from Supabase Vault at call time,
      via two secrets set once per environment, **outside any migration**:

      ```sql
      select vault.create_secret(
        'https://<project-ref>.supabase.co/functions/v1/sweep', 'sweep_function_url');
      select vault.create_secret(
        '<service role key, from Project Settings > API>', 'sweep_service_role_key');
      ```

      Run that once against this project (SQL editor, or `psql` against the
      pooler connection string), then re-apply `20260801000800` (or just the
      `do $$ ... $$` block inside it) to pick the secrets up — `cron.schedule`
      replaces a job of the same name rather than duplicating it, so this is
      safe to run more than once. Until those two secrets exist, the
      migration raises a NOTICE and leaves the job unscheduled instead of
      failing the deploy — the same "written, not yet turned on" state the
      vendor keys are already in.

      **`digest`'s schedule is built and now proven for real** (SB-017/018,
      migration `20260807000300_digest_schedule.sql`), same two-secret
      pattern, its own URL secret. `digest-enqueue` fired on its own timer
      and reached the real function with a real key, producing a real
      Anthropic Batch submission and a real row in `digest_batches`; a real
      `weekly_digests` row followed and rendered correctly in the client.
      Both SB-017 and SB-018 are `done`. See `docs/00-verification.md`.

      Verified locally: extensions install, the conditional correctly
      no-ops without secrets, and — with Vault secrets pointed at a local
      `supabase functions serve` reachable via `host.docker.internal` —
      `cron.schedule` registered the job and manually firing its exact
      command returned a real `200` from `sweep`. The test job and secrets
      were removed afterward; nothing from that test is left scheduled.

      **SB-001 closed (2026-08-06).** The gap that remained — proving the
      *schedule*, not a hand-fired command — is now closed. With the two
      secrets set, `sweep-worker` (`*/5`) fired on its own timer and returned a
      note stranded in `enriching` to `queued` with no client open:
      `cron.job_run_details` runid 3 `succeeded` at 18:35:00 UTC,
      `net._http_response` `200 {"unstuck":1,...}`. Unscheduled and secrets
      removed after that local test — local `cron.job`/`vault.secrets` empty
      again. Then proven live a second time on **hosted** at the SB-016
      deploy: all four cron jobs `active: true`. **Currently regressed**,
      though — see "The blocking point" above and SB-052: hosted cron has
      been rejected with `403` since 2026-08-17.
- [x] **Per-user rate limit on `/enrich` and `/transcribe`** (SB-002,
      2026-08-06). `ai_jobs`-backed gate (`public.rate_limit_hit()`, 60 calls /
      15 min per user/stage), checked before the pipeline is reached. Proven
      live: `verify.sql` for the SQL boundary, then 61 real sequential HTTP
      calls against the running local stack — calls 1–60 reached the vendor
      path, call 61 got a clean `429 rate_limited` before it did. Not proven
      under concurrency. Evidence: `docs/00-verification.md`.
- [x] **Strict CSP** (SB-003, 2026-08-06). No `unsafe-inline`/`unsafe-eval`,
      real header on `vite dev`/`preview` plus a `<meta>` fallback in the
      built HTML. Proven, not just configured: a real cross-origin auth call
      succeeded under `connect-src`; a deliberate disallowed `fetch()` was
      blocked and caught by a `securitypolicyviolation` listener with
      `disposition: "enforce"`. `frame-ancestors`/`report-to` can't live in
      `<meta>` — **`frame-ancestors` is closed on hosted**
      (`web/public/_headers`, confirmed by a real `curl` against
      `wamda-a8k.pages.dev`); **`report-to` is still a real, open gap**, no
      collector exists. See `docs/00-verification.md` and `docs/08-security.md`.
- [x] **`ai_jobs` retention** (SB-004, 2026-08-07). 90-day purge, daily
      `pg_cron`, no Vault secrets needed (never leaves Postgres). Proven live
      against real inserted rows in `verify.sql`; the schedule is left
      running, unlike SB-001's sweep, since nothing about it is unsafe against
      real data. Partitioning not attempted — not needed at this scale.
- [x] **Audio deletion sweep** (SB-009, 2026-08-07). `sweep` deletes the real
      Storage object per-user via the Storage API and clears `audio_path`;
      proven on a real upload/delete, confirmed with a `400` on re-fetch.
      Reuses the existing sweep schedule. See `docs/00-verification.md`.
- [x] **`ALLOWED_ORIGIN`** (SB-010, 2026-08-06). Still defaults to `*`
      locally by design; when configured, a foreign or missing preflight
      Origin is now rejected at `403`. Proven with the project's first
      `deno test`, itself proven against a deliberate regression (`00-verification.md`).
- [x] **`ai_jobs` retention** (SB-004, 2026-08-07). 90-day purge, daily
      `pg_cron`, proven against real inserted rows in `verify.sql`.
- [x] **Audio retention enforced** (SB-009, 2026-08-07). Real Storage object
      uploaded and deleted via the Storage API; `400` on re-fetch proves the
      bytes are gone, not just the row.
- [x] **Export everything** (SB-014, 2026-08-07). `GET /export`, RLS-scoped,
      proven against the owner's real 14 notes and a fresh disposable user.
- [x] **Delete everything** (SB-015, 2026-08-07). `POST /delete-account`,
      full cycle proven on a disposable user across all 10 tables plus real
      Storage bytes.
- [x] **Offline archive/dismiss queue** (SB-028, 2026-08-07). Proven with
      `kong` genuinely stopped, not simulated; queued write survives reload
      and drains correctly on reconnect. Surfaced and fixed a real bug from
      SB-003 along the way — see that entry and `00-verification.md`.
- [x] **Arabic font bundled** (SB-011). Public Sans (redesign's Latin face,
      no Arabic glyphs) paired with self-hosted Noto Sans Arabic, split by
      `unicode-range`. The Google Fonts CDN `<link>` (an offline-first
      violation) is gone.
- [x] **Weekly digest, run for real** (SB-017/018, 2026-08-07). Both
      `pg_cron` jobs fire on their own timer; a real Anthropic Batch call
      produced a real digest from the owner's real notes, correctly
      rendered in the client. Found and fixed a real bug along the way — the
      model wraps JSON in a code fence, breaking the naive parse; see
      `docs/00-verification.md` "SB-018".
- [x] **Screenshot captured**, for the capture screen at 375×812 in both colour
      schemes — which is how the dark-mode contrast bug in the theme port was
      found at all. Notes, search, digest, and auth have still never been
      looked at.

## Operational gotchas

**A new `git worktree` has no vendor keys, even if they exist elsewhere on
the machine.** `supabase/functions/.env` is gitignored by design (it holds
real secrets) — `git worktree` only carries tracked files, so a fresh
worktree's copy is simply absent, not empty. This looks exactly like "the key
was never obtained" and cost real time on 2026-08-07 before being traced: the
real `ANTHROPIC_API_KEY` was sitting in the *main* checkout the whole time.
Fix: `cp` the file from a checkout that has it, then `supabase stop &&
supabase start` **from the worktree you copied it into** — a restart alone
does not reload the Edge Runtime's env. Check key length before assuming a
key is real or placeholder (`grep '^KEY=' .env | cut -d= -f2` piped to
`wc -c`) — this repo's placeholders are 3 characters, real keys are 100+.

**The local Edge Runtime serves stale compiled code after an edit**, and
`docker restart supabase_edge_runtime_*` does **not** clear it — the container
demonstrably read the new file while still executing the old version. Only a
full `supabase stop && supabase start` worked. When a function fix "doesn't
work", confirm it is actually running before debugging the logic.

**Ports are remapped to 54421–54429** in `supabase/config.toml`, because 54322
was taken by another Supabase project on this machine.

**Never edit `config.toml` with PowerShell `-Encoding utf8`** — it writes a BOM
and the TOML parser rejects the file.

**Local test user:** `muhammad@example.test`, signed in via OTP. Codes are
readable at the Mailpit UI on `http://127.0.0.1:54424`.

## Starting a fresh session

```bash
supabase start
docker exec -i supabase_db_Second_Brain psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/verify.sql     # expect ALL SCHEMA CHECKS PASSED

cd web && npm install && npm run verify              # typecheck + RTL + 38 tests + build
npm run dev
```

Read `docs/00-verification.md` before trusting any claim about what works.

## Resolved: the design change

**This is no longer blocking.** The design arrived on 2026-08-03 as three
screens exported from Google Stitch, and is committed under `docs/design/`.
Read `docs/design/README.md` before any UI work — it is the contract.

**The decision: theme only.** Colours, type scale, spacing, radii. Where the
export contradicts behaviour that is already built and tested, the built
behaviour wins.

None of the load-bearing decisions moved. Specifically:

| Decision | Status after the design |
|---|---|
| Notes flat, no hierarchy (ADR-0004) | **Holds.** The Tasks screen is a *filter over notes*, not a container. Tapping a task opens the source note |
| Local-first capture via the outbox | Untouched |
| Arabic-first, English a config flip | Untouched. The design's own Arabic literals go to `i18n/`; the existing wording is better and stays |
| One enrichment pass at capture | Untouched |
| PWA, not native | Untouched — the export's Tailwind CDN and Google Fonts were dropped precisely because they break offline |

**The one thing that was nearly lost:** the export's capture screen replaces the
autofocused textarea with a button, costing a tap on every capture. Rejected.
Capture stays the fastest path in the app; that is the product's reason to
exist.

Two things the design does *not* answer, and that no amount of re-reading it
will fix — they need a decision, not a lookup:

- **What a note whose enrichment failed looks like.** The export supplies the
  muted-card visual language, but its muted card still has a title and a
  summary — exactly what a failed enrichment lacks. See SB-032.
- **How a save is confirmed if capture stays in place.** The export draws no
  confirmation state at all. Today the confirmation is the note itself
  appearing in the timeline, which is strong. Do not remove that without a
  replacement that is as convincing. See SB-037.

**Done.** SB-031a (theme), SB-036 (Tasks screen), SB-037 (open the note from a
task), SB-038 (`completed_at`), SB-033 (answered-suggestion feedback), SB-011
(fonts), and SB-050 (due-soon badge) are all closed — see `docs/13-tasks.md`
"Done". **SB-032** is done (a note that fails enrichment stays visible).
**SB-027** is now only partially open: the task half is built through the
items above; the `event`/calendar half is not — see SB-027 in
`docs/13-tasks.md` for the split.

## What's actually left (as of 2026-08-20)

The project is in a materially different place than the last time this
section was written. Almost nothing is blocked on a vendor key anymore — the
live issue is operational, not a missing capability.

**Needs the owner, right now, time-sensitive:**
- **SB-052** — hosted `sweep`/`digest` cron rejected with `403` since
  2026-08-17. Re-set the Vault service-role secret before Saturday
  2026-08-22, 03:00 UTC, or the weekly digest fails the same way.

**Open, no blocker, just not yet run** (fair game for the next session):
- **SB-006** — the cross-lingual retrieval test. Embeddings exist; the
  specific two-note AR/EN test that decides whether phase 2 English is
  cheap has never been executed. One afternoon.
- **SB-022** — Safari/Firefox testing (S, needs real Safari/Firefox — only
  Chromium tooling has been available so far).
- Android voice capture — iOS is proven end to end; Android has not been
  tried in either direction.

**Deliberately deferred, agreed with the owner:**
- **SB-027's event half** — a `create_event` destination and calendar view.
  The task half already shipped through SB-036/037/038/033/050; nothing about
  events has been asked for or designed yet.
- **SB-035** — one end-to-end test (M, deliberately the one place a
  browser-automation dependency is worth adding). **The owner is doing this
  one himself** — an earlier session attempt was stopped mid-task on
  request and its partial changes (Playwright dep, `web/e2e/`) discarded so
  he could start clean.

**Open, no urgency:**
- `report-to` CSP violation collector (no task id yet) — see `docs/08-security.md`.
