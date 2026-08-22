# 12. Roadmap

> Milestones, each with an **exit criterion that can be observed**, not a
> feeling of doneness. `06-integration-plan.md` explains why the phases are
> ordered this way; this file is the schedule and the gates.
>
> No dates. This is a single-developer project with an agent doing much of the
> work; sequence is real, calendar estimates would be fiction.

---

## ملخّص بالعربي

الخريطة دي مقسّمة مراحل، وكل مرحلة ليها **شرط خروج** تقدر تشوفه بعينك — مش
"خلصنا تقريبًا". المرحلة متتقفلش غير لما الشرط ده يتحقّق فعلًا وينتكتب في
`docs/00-verification.md`.

كل المفاتيح موجودة ومشتغلة فعليًا (M2/M3 خلصوا). SB-052 (رفض cron الاستضافة)
اتحل ٢٢ أغسطس — السبب الحقيقي كان Supabase غيّرت مفتاح من غير تنبيه، والحل
بقى الكود يعتمد على سرّ المشروع نفسه بدل مفتاح المنصة.

---

## Where we are

```
M0 ████████████ done      schema · functions · client · verification harness
M1 ████████████ done      auth + capture against a real server
M2 ███████████░ done*     enrichment + embeddings live · *SB-006 cross-lingual test still unrun
M3 ████████████ done      voice live end to end on hosted (SB-007); Android untested
M4 ░░░░░░░░░░░░ later     search tuning — needs a real corpus (~100 notes)
M5 ████████████ done      sweep + digest scheduled, proven, and fixed for real (SB-052, 2026-08-22)
M6 ████████████ done      hardening: rate limits · CSP · export/delete · hosted deploy (SB-016)
M7 ░░░░░░░░░░░░ later     English — gated on SB-006, not on a key
```

## M0 — Foundations ✅

Schema, RLS, RPCs, eight Edge Functions, React PWA, verification harness.

**Exit (met):** `verify.sql` prints `ALL SCHEMA CHECKS PASSED`; `npm run verify`
green; offline capture demonstrated in a browser with no server running.

## M1 — The two halves talk ✅

Email OTP auth, capture round trip, outbox replay, pre-auth attach.

**Exit (met):** a note captured while signed out lands in Postgres under the
right user after sign-in, exactly once.

## M2 — Enrichment and semantic search ✅ (one measurement still open)

Enrichment and embeddings are both **done and run for real** (SB-005, 2026-08-13).

- [x] Enrichment against Claude Sonnet 5 (revised from Opus 5, SB-034), real
      Arabic output
- [x] Prompt caching measured
- [x] Stage isolation so an embedding failure doesn't lose enrichment
- [x] **`COHERE_API_KEY`** → embeddings, semantic arm — 14/14 `ready` notes
      embedded for real (SB-045)
- [x] Hybrid search returning fused results from both arms — confirmed live
      through a real signed-in session
- [x] Backfill embeddings for existing `ready` notes via `sweep` (SB-008)

**Exit met, except one clause:** `note_embeddings` is non-empty for every
`ready` note ✅. The **cross-lingual** half of the exit criterion — an Arabic
query with no keyword overlap returning an English note — has not been run as
its own deliberate test (SB-006, still `blocked` on being executed, not on
anything structural). `relate_note()` was called for all 14 notes but nothing
yet reads `note_relations` to confirm a pair cleared the threshold.

## M3 — Voice on a real device ✅ (Android untested)

- [x] **`ELEVENLABS_API_KEY`** → first real transcription (SB-007)
- [x] Corrected `ScribeASR.transcribe` against the real observed response
      shape — it differed from documentation, as expected
- [x] Record → upload → transcribe → enrich, full pipeline, hosted, on a real
      iPhone (Safari): confidence 0.925, `category: task`, reached `ready`
- [x] ASR quality checked against a real spoken sentence in the user's own
      dialect — not yet a formal WER measurement across many samples
- [x] `MediaRecorder` confirmed working on iOS Safari for real, after fixing
      the codec-qualified MIME type it actually sends
- [ ] Android — either direction, still untested

**Exit met on iOS.** A voice note spoken by the owner reached `ready` with a
transcript, on their own phone, not a desktop browser. Getting there took six
real bugs across two days (docs/00-verification.md bugs #8–12) — the
measurement mattered exactly as much as this milestone said it would.

## M4 — Search that is actually good ⬜

Needs ~100 real notes. Tuning against three test notes is theatre.

- [ ] Accumulate a real corpus through daily use
- [ ] Tune RRF weights and the 0.78 relation threshold against it
- [ ] Measure "intended note in top 5" against real queries

**Exit:** >80% of a written set of 20 real recall attempts hit in the top 5.

## M5 — It runs without you ✅ (SB-052 resolved 2026-08-22)

- [x] `pg_cron` + `pg_net` schedule for `sweep` (SB-001) — proven live locally,
      then live on hosted at deploy (SB-016): all four cron jobs `active: true`
- [x] `pg_cron` schedule for the weekly `digest` (SB-017) — same, live on hosted
- [x] Service role key in Vault, not in a migration — true by construction;
      a stray `format(...)` draft that would have baked the digest key into
      `cron.job`'s stored text was caught before it was ever applied
- [x] First digest actually executed (SB-018) — a real Anthropic Batch
      submission produced a real `weekly_digests` row, rendered correctly in
      the client. Found and fixed a real bug along the way: the model wraps
      its JSON in a code fence, breaking the naive parse

**Exit met, three times.** A note deliberately stranded in `enriching` was
recovered with no client open, locally (2026-08-06), on hosted at first
deploy, and again after SB-052's fix (2026-08-22, real `200` with real
execution). Hosted cron was rejected with `403` 2026-08-17 → 2026-08-22 --
root cause was Supabase's own key migration, not anything in this project's
schedule design; fixed by moving off a platform-managed credential entirely
(`CRON_SECRET`). This Saturday's digest tick fired before the fix and was
missed; next tick (2026-08-29) is on the fixed path. See SB-052.

## M6 — Safe to leave running ✅ (one header still missing)

- [x] Per-user rate limit on `/enrich` and `/transcribe` (SB-002) — proven local
- [x] Strict CSP (SB-003) — load-bearing, not hardening; `frame-ancestors`
      confirmed live on hosted via `web/public/_headers` and a real `curl`.
      `report-to` is a genuinely open gap — no collector exists
      (`docs/08-security.md`)
- [x] `ALLOWED_ORIGIN` pinned (SB-010) — set on hosted, foreign preflight
      Origin rejected for real
- [x] Export everything (SB-014) and delete everything (SB-015) — both proven
      with real data and a full deletion cycle
- [x] Audio retention enforcement (SB-009) — proven on a real upload and delete
- [x] `ai_jobs` retention (SB-004) — 90-day purge, daily `pg_cron`, proven live
- [x] Deployed to a real Supabase project (SB-016, 2026-08-09) — live at
      `wamda-a8k.pages.dev`, three real deploy bugs found and fixed

**Exit substantially met.** The one open piece is `report-to` — CSP violations
today are visible only in a browser's own DevTools, not centralized. Not
tracked under a task id yet.

## M7 — English ⬜

The point of the language seams. Three flags, no migration.

- [ ] Verify cross-lingual retrieval with a real AR/EN pair **first** — if it
      fails, this milestone changes shape entirely
- [ ] `en.enabled = true` in both registries
- [ ] Language picker appears
- [ ] Render a populated screen with mixed-language content and check the
      RTL→LTR switch

**Exit:** an Arabic query returns an English note that shares no keyword with it.

**This milestone is gated on a fact nobody has checked.** The Cohere key has
arrived and embeddings are live (M2) — the deliberate two-note cross-lingual
test (SB-006) still has not been run. Do that before M7 starts.

## The redesign, and the destination it unblocked

The Google Stitch redesign (SB-031) landed 2026-08-03, theme-only — see
`docs/design/README.md`. It is done; nothing about it is still incoming.

### M8 — Somewhere for a note to go 🟡

**Agreed with the owner, sequenced after the redesign — the redesign is now
done, and most of this milestone is too.**

The AI already decides a note is a task, gives it a priority, and resolves
"الخميس" into a real timestamp. Accepting a suggestion now has a real
destination.

- [x] The redesign landed first (SB-031)
- [x] Accepting and dismissing are distinct recorded states
      (`action_dismissed_at`), not one nullable timestamp — SB-033 gives an
      answered suggestion a visible result
- [x] Tasks screen: a real filter over notes, not a container (SB-036),
      opens the source note (SB-037), can be ticked done (SB-038)
- [x] `action_due_at` drives grouping (today / this week / later) and, since
      SB-050, a due-soon badge visible from the Capture tab and an overdue
      marker distinct from "due today"
- [ ] `create_event` / a calendar view — tasks have a destination; events
      still do not

**Exit substantially met for tasks.** The owner captures
"لازم أراجع العرض مع أحمد قبل اجتماع الخميس", accepts the suggestion, and
finds it in the Tasks screen grouped and dated correctly, with a badge that
reaches him before he opens that screen — without typing a date or a title.
What is not built: a calendar destination for `event`-category notes.

**The constraint that survived it:** ADR-0004 held. A task is a *view over a
note*, never a container a note moves into — the Tasks screen and its badge
are both filters over the same `notes` table, not a second store.

## Cross-cutting, no milestone

Do these whenever they become cheap; none of them blocks a milestone.

- [x] CI on a real runner — ran for the first time 2026-08-02, caught a real
      bug on its first attempt
- [x] Bundle the Arabic font (SB-011) — Public Sans + self-hosted Noto Sans
      Arabic, no CDN
- [x] Queryable pipeline failures over `ai_jobs` (SB-019)
- [x] Success metrics instrumented (SB-020) — real numbers in
      `docs/10-product-spec.md`, including one that changed the enrichment
      cost target
- [ ] Safari/Firefox testing — only Chromium tooling was available so far
- [ ] `report-to` CSP violation collector — no task id yet

## Resolved: the design change that could have reordered this

**No longer open.** The design arrived 2026-08-03 (SB-031, Google Stitch),
theme-only, and every load-bearing decision it touched — flat notes
(ADR-0004), local-first capture, one enrichment pass, PWA — held. See
`docs/09-status-handoff.md` "The design, and what survived it" for the full
account.
