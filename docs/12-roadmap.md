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

الحاجز الحالي: **مفتاحين API** (Cohere و ElevenLabs). قبلهم، M2 و M3 مقفولين.

---

## Where we are

```
M0 ████████████ done      schema · functions · client · verification harness
M1 ████████████ done      auth + capture against a real server
M2 ██████░░░░░░ partial   enrichment live · embeddings BLOCKED (no Cohere key)
M3 ░░░░░░░░░░░░ blocked   voice — no ElevenLabs key, no real device test
M4 ░░░░░░░░░░░░ later     search tuning — needs a real corpus
M5 ░░░░░░░░░░░░ later     scheduling: sweep + digest on cron
M6 ░░░░░░░░░░░░ later     hardening: rate limits · CSP · export/delete
M7 ░░░░░░░░░░░░ later     English
```

## M0 — Foundations ✅

Schema, RLS, RPCs, five Edge Functions, React PWA, verification harness.

**Exit (met):** `verify.sql` prints `ALL SCHEMA CHECKS PASSED`; `npm run verify`
green; offline capture demonstrated in a browser with no server running.

## M1 — The two halves talk ✅

Email OTP auth, capture round trip, outbox replay, pre-auth attach.

**Exit (met):** a note captured while signed out lands in Postgres under the
right user after sign-in, exactly once.

## M2 — Enrichment and semantic search 🟡

Enrichment is **done and run for real**. Embeddings are the whole remaining gap.

- [x] Enrichment against Claude Opus 5, real Arabic output
- [x] Prompt caching measured
- [x] Stage isolation so an embedding failure doesn't lose enrichment
- [ ] **`COHERE_API_KEY`** → embeddings, semantic arm, `relate_note()`
- [ ] Hybrid search returning fused results from both arms
- [ ] Backfill embeddings for existing `ready` notes via `sweep`

**Exit:** an Arabic query with **no keyword overlap** with the target note
returns that note from the semantic arm, and `note_embeddings` is non-empty for
every `ready` note.

**Blocked on:** one API key. Everything else in M2 is written.

## M3 — Voice on a real device ⬜

- [ ] **`ELEVENLABS_API_KEY`** → first real transcription
- [ ] Correct `ScribeASR.transcribe` against the observed response shape
      (currently written from documentation)
- [ ] Record → upload → transcribe → enrich on an actual iPhone and Android
- [ ] Measure ASR quality on the user's own dialect
- [ ] Confirm `MediaRecorder` on iOS Safari, or ship the honest-degradation path

**Exit:** a voice note spoken in the user's dialect on their own phone reaches
`ready` with a transcript the user judges usable, and the WER is written down.

**Do not skip the measurement.** ASR quality is product risk #1; a working
pipeline with a bad transcript is a failed feature that looks like a shipped one.

## M4 — Search that is actually good ⬜

Needs ~100 real notes. Tuning against three test notes is theatre.

- [ ] Accumulate a real corpus through daily use
- [ ] Tune RRF weights and the 0.78 relation threshold against it
- [ ] Measure "intended note in top 5" against real queries

**Exit:** >80% of a written set of 20 real recall attempts hit in the top 5.

## M5 — It runs without you ⬜

The pipeline currently only advances when a client is open.

- [ ] `pg_cron` + `pg_net` schedule for `sweep` (SB-001)
- [ ] `pg_cron` schedule for the weekly `digest`
- [ ] Service role key in Vault, not in a migration
- [ ] First digest actually executed — Batch API + structured outputs is
      unverified and the fallback path matters

**Exit:** a note deliberately stranded in `enriching` is recovered without any
client open, and one real weekly digest exists in the database.

## M6 — Safe to leave running ⬜

- [x] Per-user rate limit on `/enrich` and `/transcribe` (SB-002) — proven local-only; a hosted deploy still needs the runbook check below
- [x] Strict CSP (SB-003) — load-bearing, not hardening; done and proven local-only, a hosted deploy still needs `frame-ancestors`/`report-to` at the host's header layer (SB-016)
- [ ] `ALLOWED_ORIGIN` pinned (SB-010)
- [ ] Export everything (SB-014) and delete everything (SB-015)
- [ ] Audio retention enforcement (SB-009)
- [ ] `ai_jobs` retention (SB-004)
- [ ] Deployed to a real Supabase project (SB-016)

**Exit:** the app can be left running for a month unattended without an
unbounded bill, an unbounded table, or an XSS being a full account compromise.

## M7 — English ⬜

The point of the language seams. Three flags, no migration.

- [ ] Verify cross-lingual retrieval with a real AR/EN pair **first** — if it
      fails, this milestone changes shape entirely
- [ ] `en.enabled = true` in both registries
- [ ] Language picker appears
- [ ] Render a populated screen with mixed-language content and check the
      RTL→LTR switch

**Exit:** an Arabic query returns an English note that shares no keyword with it.

**This milestone is gated on a fact nobody has checked.** Test cross-lingual
retrieval the day the Cohere key arrives, in M2 — long before M7 starts.

## Incoming: a UI redesign, then a destination

A new design is being produced in Google Stitch (SB-031). It is not specified
yet, so nothing is planned against it — but it lands on the screens M2–M4 touch,
so **do not invest in visual polish before it arrives**. Structural work
(SB-024, SB-025) is safe: it changes what the screens must show, which the
design has to accommodate regardless.

### M8 — Somewhere for a note to go ⬜

**Agreed with the owner, and deliberately sequenced after the redesign.**

The AI already decides a note is a task, gives it a priority, and resolves
"الخميس" into a real timestamp. Then the user clicks "أضفها كمهمة" and nothing
is created anywhere — the promise the product is built on stops one step short
of being kept. This milestone builds the destination: tasks and calendar
entries that live inside the product (SB-027), with the visible result an
answered suggestion currently lacks (SB-033).

- [ ] The redesign lands first (SB-031) — what a task *looks* like decides
      what it *is*
- [ ] Accepting and dismissing become distinct recorded states, not one
      nullable timestamp
- [ ] `create_task` and `create_event` produce something the user can open
- [ ] `action_due_at` drives a calendar view, using dates the pipeline already
      resolves correctly

**Exit:** the owner captures "لازم أراجع العرض مع أحمد قبل اجتماع الخميس",
accepts the suggestion, and finds it waiting for him on Thursday without
having typed a date, a title, or a list name.

**The constraint that must survive it:** ADR-0004. A task is a *view over a
note*, never a container a note moves into. If the design implies folders,
supersede the ADR on purpose rather than drifting into hierarchy by accident.

## Cross-cutting, no milestone

Do these whenever they become cheap; none of them blocks a milestone.

- CI on a real runner (`.github/workflows/ci.yml` has never executed)
- Bundle the Arabic font (SB-011)
- Structured logging and alerting (SB-019)
- Analytics for the success metrics in `10-product-spec.md` (SB-020)
- Safari/Firefox testing

## The thing that could reorder all of this

The user has flagged **an unspecified significant design change**. Milestones
M4–M7 assume the product shape recorded in `09-status-handoff.md` (flat notes,
one enrichment pass, PWA, local-first outbox). Ask what the change is before
planning past M3.
