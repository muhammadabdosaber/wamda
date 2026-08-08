# 10. Product Spec

> The "why" layer. `01-architecture.md` says how the system is shaped;
> this says what it is for and how we will know it worked.
> Written after the fact, from decisions already embedded in the code — where
> this doc and the code disagree, the code is the record and this doc is the bug.

---

## ملخّص بالعربي

المنتج ده مش تطبيق ملاحظات. ده **مكان ترمي فيه الفكرة قبل ما تضيع**.
المستخدم بيفكّر بالعربي وعنده ADHD، يعني الفكرة ليها ثواني معدودة قبل ما تروح.
فأي احتكاك — فتح القفل، اختيار مجلد، كتابة عنوان — بيخسّر الفكرة.

القاعدة الأساسية: **الالتقاط لازم يكون فوري ومحلي**، والتنظيم بيحصل بعدين
بالذكاء الاصطناعي. لو المستخدم اضطر ينظّم بنفسه، يبقى المنتج فشل.

---

## The problem

A person who thinks in Arabic and has ADHD loses thoughts inside a window
measured in seconds. Every existing note app spends that window asking
questions: which notebook, which title, which tag. By the time the question is
answered the thought is gone.

Arabic makes it worse. Most tools treat Arabic as an afterthought — RTL half
works, search does not fold spelling variants, and AI features are tuned on
English. So the user either fights the tool or writes in a second language,
which adds latency in exactly the wrong place.

## The product, in one sentence

**Speak or type a thought in Arabic; it is durable before you finish, and AI
files it so you never have to.**

## Principles, in priority order

When two of these conflict, the higher one wins. This ordering is the product.

1. **Capture latency beats everything.** Storage latency, not network latency.
   Offline is the normal case, not the error case.
2. **Never lose a note.** A note that reached the device is never lost to a
   crash, a 500, a dead vendor, or a stuck pipeline stage.
3. **Zero organizing work from the user.** No folders, no required titles, no
   mandatory tags. The AI files it, or it stays unfiled and still findable.
4. **Arabic is the first-class language**, not a translation target.
5. **Degrade honestly.** A failed stage produces a visibly partial note, never
   a fake-complete one and never an invisible one.
6. **Privacy by ownership.** The user's notes are readable only by the user;
   enforced in the database, not in application code.

## Who it is for

| | Primary | Secondary (phase 2+) |
|---|---|---|
| Who | Arabic-first thinker with ADHD; the author | Bilingual AR/EN knowledge worker |
| Device | Phone, one hand, often walking | Desktop, longer sessions |
| Peak need | Idea arrives at a bad moment | Recalling something from months ago |
| Failure they fear | "I had an idea and I lost it" | "I know I wrote it, I can't find it" |

Explicitly **not** for: teams, shared workspaces, or anyone who wants to
hand-organize a knowledge base. Those are different products with a different
capture latency budget.

## Core user journeys

### J1 — Capture (the one that matters)

Open app → type or hold-to-record → the thought is durable. No title, no
category, no destination chosen. Target: **under 3 seconds** from app open to
durable, offline, with no server reachable.

**Acceptance:** the note survives an immediate app kill and a week offline, and
replays exactly once when connectivity returns.

### J2 — It files itself

Within roughly a minute of connectivity, the note has a title, summary,
category, priority, tags, and a resolved due date if the text implied one
("الخميس" → an actual timestamp). The user did nothing.

**Acceptance:** enrichment output is in Arabic, stored as language-neutral
enum keys, and tag spelling variants converge on one tag.

### J3 — Recall

Ask in natural Arabic and find the note, including when the spelling differs
from what was stored, and including when the wording is different but the
meaning is the same (semantic arm).

**Acceptance:** lexical hits survive alef/haa/tatweel variation; semantic hits
work without any shared keyword. Cross-lingual (Arabic query → English note) is
a phase-2 acceptance, currently **unproven** — see `docs/00-verification.md`.

### J4 — Weekly review

Once a week, a digest of what was captured: themes, open tasks, things that
were flagged for later. Read-only, cheap, batch.

### J5 — Trust and exit

The user can see what the system did to a note (raw text preserved next to the
AI's version), export everything, and delete everything.
**Built and proven** — `GET /export`, `POST /delete-account` (SB-014/SB-015,
2026-08-07). No settings screen exposes them in the client UI yet; both are
real, tested API endpoints. `docs/00-verification.md`.

## Scope

### In, phase 1

Text capture · voice capture · offline outbox · AI enrichment · Arabic
normalized lexical search · semantic search · related notes · weekly digest ·
email OTP auth · installable PWA · Arabic RTL UI.

### In, later

English (phase 7 — wired, disabled) · scheduled digest.

**Done ahead of schedule, 2026-08-06/07:** rate limits (SB-002), CSP (SB-003),
`ALLOWED_ORIGIN` (SB-010), `ai_jobs` retention (SB-004), audio retention
enforcement (SB-009), export/delete (SB-014/SB-015), and the sweep schedule
mechanism (SB-001, proven live but left unscheduled locally — see
`docs/09-status-handoff.md`). All proven with real data, not just written —
`docs/00-verification.md`.

### Out, deliberately

- **Hierarchy** — no folders, notebooks, or projects. Tags plus search only.
  This is a product decision, not a missing feature; hierarchy reintroduces the
  filing decision that principle 3 exists to remove.
- **Sharing, collaboration, comments.** Single-user by construction; RLS
  assumes it.
- **Rich text, attachments beyond audio, drawing.**
- **Native apps.** PWA, accepting the iOS cost — see ADR-0006.
- **Editing the AI's output as a first-class flow.** Re-run enrichment instead.

## Success metrics

Three of these are now instrumented (SB-020, 2026-08-08): `capture_latency_stats`,
`stuck_notes`, and `note_cost`/`cost_summary`
(`docs/02-database-schema.md` "Operational views") — read manually in
Supabase Studio, no dashboard yet. The rest still have no analytics.

| Metric | Target | Why this number | Status |
|---|---|---|---|
| Capture latency (open → durable) | p95 < 3 s | Longer than this and the thought is lost | Instrumented, but only 1 real sample so far (73 ms) — every pre-2026-08-08 note predates the column |
| Notes lost | **0** | Principle 2; any loss is a P0 | Not instrumented |
| Notes stuck outside a terminal state > 1 h | 0 | The sweep worker's reason to exist | Instrumented — **2 real notes at 38.6 h** as of 2026-08-08, both from before the vendor-key fix |
| Enrichment cost per note | < $0.015 | Early spot-measurement (2 notes, SB-000f): $0.008–0.011 | Instrumented — **$0.018827 average over 11 real notes**, above target. **Root cause found:** the target assumed prompt caching (5-min TTL) lands consistently; it doesn't for this product's actual usage (notes captured throughout the day, not in bursts) — real cache hits average $0.0094/call, misses $0.0220/call. `docs/00-verification.md` "SB-020" |
| Search: user finds intended note in top 5 | > 80% | Needs a real corpus (~100 notes) | Not instrumented; blocked on SB-005/006 too |
| Unedited AI categories | > 70% | If the user constantly corrects, filing failed | Not instrumented |
| Weekly digest opened | > 50% of weeks | Below this, the digest is not worth its cost | Not instrumented |

## Product risks

Ranked by what would actually kill the product.

1. **ASR quality on the user's dialect.** Unmeasured. If voice is unreliable,
   the fastest capture path is gone and the product degrades to a typed note
   app. Mitigation: `ASRProvider` is one interface; Azure has `ar-AE` models.
2. **Cross-lingual retrieval does not behave as assumed.** The entire
   "English costs no migration" claim rests on it. Untested — highest-value
   unknown in the project.
3. **iOS PWA limits.** No background sync, `MediaRecorder` availability
   unverified, storage eviction under pressure unverified.
4. **AI filing quality is merely okay.** A user who corrects every category is
   doing the organizing work the product promised to remove.
5. **Cost runaway.** Mitigated (SB-002): a per-user, per-stage rate limit
   (60 calls / 15 min) now gates `/enrich` and `/transcribe`, proven live —
   `docs/00-verification.md`.

## Open product questions

- The user has flagged **an unspecified significant design change**. Several
  decisions above are load-bearing; ask before building against them
  (`docs/09-status-handoff.md`).
- Does a note ever need to be *edited* after enrichment, or only re-enriched?
- Is the digest email, in-app, or both? Currently in-app only.
- What is the retention default for audio? The column exists; nothing enforces it.
