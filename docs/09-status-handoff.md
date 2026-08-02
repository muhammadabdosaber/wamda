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

**حاجة معلّقة:** فيه تعديل مهم في التصميم لسه متحدَّدش — **متبدأش تنفيذ قبل
ما تسأل عنه**، لأنه ممكن يغيّر قرارات أساسية مكتوبة تحت.

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
| Weekly digest | Written, never executed |
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
      **Still open: nothing schedules it.** No `pg_cron` job exists anywhere
      in the migrations (digest has the same gap — written, never wired).
      Wiring one needs the project's Vault-stored service role key and a
      `pg_net.http_post` call to the deployed function URL, which is
      environment-specific and wasn't done here.
- [ ] **Per-user rate limit on `/enrich` and `/transcribe`.** Unbounded today —
      a runaway client loop is a runaway bill.
- [ ] **Strict CSP.** Load-bearing, not hardening: `supabase-js` keeps the
      session in `localStorage`, so one XSS is a full session compromise. See
      the session section in `docs/08-security.md`.
- [ ] **`ai_jobs` retention/partitioning.** Grows without limit.
- [ ] **Audio deletion sweep.** `profiles.audio_retention_days` exists; nothing
      enforces it.
- [ ] **`ALLOWED_ORIGIN`** defaults to `*`.
- [ ] **Arabic font not bundled.** `global.css` names IBM Plex Sans Arabic /
      Noto Sans Arabic first, but neither ships — currently falling back to a
      system face.
- [ ] **Digest never run**, and its Batch-API-plus-structured-outputs
      combination is unverified.
- [ ] **Screenshot never captured.** The Browser pane would not composite
      across many attempts; the app itself renders correctly (verified through
      DOM and computed styles).

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

## Pending: an unspecified design change

The user has flagged **a significant design change** plus further integration
work, to be discussed in a new session. It has not been described yet.

**Do not begin implementation against the assumptions in these docs until that
change is understood** — several decisions recorded here are deliberately
load-bearing and would need revisiting if the shape of the product moves:

- notes as flat, independent objects (no hierarchy, projects, or notebooks)
- one enrichment pass per note, at capture time
- Arabic-only in phase 1, English as a pure config flip
- local-first capture with an outbox as the sync model
- PWA rather than native — which caps background sync and iOS voice capture

Ask what the change is first. Some of the above are cheap to revisit; the
storage and language-seam decisions are not.
