# 9. Status & Handoff

> **Written to be the first file a fresh session reads.** It records where the
> project actually stands, what is blocking it, and what must not be
> re-litigated. Detail lives in the other docs; this is the map.

---

## ملخّص بالعربي

**اللي خلص:** قاعدة البيانات كاملة ومتحقَّق منها (‏12 فحص)، خمس Edge Functions،
تطبيق React PWA عربي RTL بالكامل مع التقاط يشتغل أوفلاين، تسجيل دخول برمز
مكوّن من ٦ أرقام، وخط معالجة ذكاء اصطناعي **اشتغل فعليًا** على ملاحظتين عربيتين
ووصلوا لحالة `ready`.

**واقفين على إيه:** مفتاحين من التلاتة لسه placeholders —
**Cohere** (يعني مفيش بحث دلالي ولا ربط بين الملاحظات ولا اختبار للاسترجاع
عبر اللغات، وده أساس المرحلة التانية) و **ElevenLabs** (يعني التسجيل الصوتي
متجربش خالص). كل الكود موجود ومتحقَّق من أنواعه، بس المسارات دي محصلتش ولا مرة.

**التصميم وصل** (٣ أغسطس ٢٠٢٦) وبقى في `docs/design/`. القاعدة: **الثيم بس** —
أي حاجة في التصميم بتتعارض مع سلوك اتبنى واتجرّب، السلوك المبني هو اللي يكسب.
اقرا `docs/design/README.md` قبل أي شغل واجهة. مفيش قرار أساسي اتحرك.

---

## Where the project stands

| Layer | State |
|---|---|
| Schema, RLS, RPCs | **Done, verified** — 12 checks against live Postgres |
| Edge Functions (5) | **Done, type-checked**; `notes` + `enrich` run for real |
| React PWA client | **Done, verified in a browser** — 21 tests, RTL guard, build |
| Auth (email OTP) | **Done, verified end to end** via local mail catcher |
| AI enrichment | **Done, run against Claude Opus 5** — real Arabic output |
| Prompt caching | **Measured**, not estimated — 2169 cached tokens/call |
| Embeddings / semantic search | **Blocked** — no Cohere key |
| Voice / transcription | **Blocked** — no ElevenLabs key |
| Weekly digest | Schedule built and proven live; blocked on `ANTHROPIC_API_KEY` for a real run |
| English (phase 2) | Wired, deliberately disabled |

Full evidence ledger: `docs/00-verification.md`.

## The blocking point

Two vendor keys in `supabase/functions/.env` are still placeholders. This is
the single thing standing between the current state and a complete product.

**`COHERE_API_KEY`** — without it:
- `note_embeddings` is empty; no note is semantically searchable
- `relate_note()` has never produced a row, so note relations are unproven
- **cross-lingual retrieval is untested**, and that is the load-bearing
  assumption behind the whole phase-2 English plan. If Cohere's shared
  Arabic/English vector space does not behave as expected, the "adding English
  costs no migration" claim weakens considerably. This is the highest-value
  unknown in the project.

**`ELEVENLABS_API_KEY`** — without it:
- voice capture has never been exercised end to end
- `ScribeASR.transcribe` parses a response shape taken from documentation and
  never observed; expect it to need adjustment on first real call
- ASR quality on the user's own dialect — flagged from the start as the
  largest product risk — remains completely unmeasured

Everything else below is smaller than these two.

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

## Open engineering items

Ordered by consequence, not effort.

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

      **`digest`'s schedule is now built too** (SB-017, migration
      `20260807000300_digest_schedule.sql`), same two-secret pattern, its own
      URL secret. Both `digest-enqueue` and `digest-collect` were proven to
      fire on their own timer and reach the real function; the vendor key
      still blocks the part that matters (a real `digest_batches` row), so
      SB-017 is filed `blocked`, not `done`. See `docs/00-verification.md`.

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
      `net._http_response` `200 {"unstuck":1,...}`. The follow-on retry still
      fails enrich/embed for want of vendor keys, so only the unstick arm is
      proven live; a hosted run is SB-016. Unscheduled and secrets removed
      after — local `cron.job`/`vault.secrets` empty again. Evidence:
      `docs/00-verification.md`.
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
      `<meta>` — whatever host SB-016 deploys to must set those at the server
      layer. See `docs/00-verification.md` and `docs/08-security.md`.
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
- [ ] **Digest schedule built and proven live** (SB-017, 2026-08-07) — both
      `pg_cron` jobs fire on their own timer and reach the real function.
      **Still blocked**: the task's actual accept line (a real
      `digest_batches` row) needs `ANTHROPIC_API_KEY`, which this worktree
      does not have.
- [x] **Screenshot captured**, for the capture screen at 375×812 in both colour
      schemes — which is how the dark-mode contrast bug in the theme port was
      found at all. Notes, search, digest, and auth have still never been
      looked at.

## Operational gotchas

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

cd web && npm install && npm run verify              # typecheck + RTL + 21 tests + build
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
task), SB-038 (`completed_at`), SB-033 (answered-suggestion feedback), and
SB-011 (fonts) are all closed — see `docs/13-tasks.md` "Done". The two
redesign-adjacent items still open are **SB-032** (done — a note that fails
enrichment stays visible) and **SB-027** (a real destination for accepted
suggestions — agreed with the owner, deliberately deferred, see below).

## What's actually left (as of 2026-08-07)

Everything reachable without a vendor key or the owner's own account/design
input is done. What remains, grouped by why it's not done:

**Blocked on API keys the owner has to supply** (no code work possible until
then):
- SB-005/006/008 — Cohere key → embeddings, semantic search, cross-lingual
  retrieval test (the single highest-value unknown in the project)
- SB-007/012/013 — ElevenLabs key → real transcription, phone testing, WER
- SB-017/018/034 — `ANTHROPIC_API_KEY` → digest actually running, model
  cost/quality comparison

**Blocked on the owner's own account/infra:**
- SB-016 — deploy to a real hosted Supabase project

**Deliberately deferred, agreed with the owner:**
- SB-027 — destination for accepted suggestions (task/calendar). Owner
  decided: build the real thing, sequenced after design feedback, not the
  cheap relabel. He said he may adjust design/colours and add features next —
  start there before touching this.

**Open, no blocker, just not yet started** (fair game for the next session):
- SB-019 — structured logging/alerting (M, scope still vague — worth
  narrowing with the owner first)
- SB-020 — instrument the success metrics from `docs/10-product-spec.md` (M,
  same caveat)
- SB-022 — Safari/Firefox testing (S, needs real Safari/Firefox — only
  Chromium tooling was available this session)
- SB-035 — one end-to-end test (M, deliberately the one place a
  browser-automation dependency is worth adding)
