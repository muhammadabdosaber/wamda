# 14. Testing Strategy

> What we test, where, and — more importantly — **what we refuse to call
> tested**. The rule this project already lives by: *code that has only ever
> passed is not known to work.* The RTL guard was deliberately broken to prove
> it fails; do that with every guard you add.

---

## ملخّص بالعربي

القاعدة: **أي فحص عمره ما فشل، مش فحص**. لازم تكسره عمدًا مرة واحدة عشان تتأكد
إنه بيمسك الغلط. وده اللي اتعمل مع فاحص الـRTL.

وكمان: الكود اللي بيعدّي من `tsc` مش معناه إنه اشتغل. الاتنين حاجتين مختلفين.

---

## The five layers

| Layer | Tool | Runs where | Catches |
|---|---|---|---|
| Schema truth | `supabase/tests/verify.sql` | live Postgres | RLS holes, normalization, idempotency |
| Function types | `deno check` | CI | wrong vendor API surface |
| Function units | `deno test` | CI | pure-logic bugs in `_shared/*.ts` that need no DB or vendor |
| Client units | `vitest` | CI | i18n, plurals, language resolution |
| Client guards | `tool/check-rtl.mjs` | CI | physical CSS properties that break RTL |

Plus the layer no tool covers: **live verification**, recorded by hand in
`docs/00-verification.md`.

## What each layer is actually for

### `verify.sql` — the one that matters most

26 assertions against a real Postgres, not a mock (grew from 12 as the schema did — rate limiting, retention, cost tracking, the scoped grant). It exists because the two
highest-consequence properties of this system are database properties:

- **Cross-user isolation.** User B authenticates, queries user A's note id
  directly, gets zero rows — checked independently on `notes`, `note_tags`, and
  `note_embeddings`. Not "the policy looks right"; the query returns nothing.
- **Arabic normalization on real data.** A note stored with taa-marbuta is
  found by a query typed with haa.

```bash
docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
# expect: ALL SCHEMA CHECKS PASSED
```

**Every new table gets an RLS assertion here, in the same PR.** The suite
already asserts that *every* public table has RLS enabled, so a new table
without a policy fails the run — keep it that way.

### `deno check` — stronger than it sounds

It validated the Anthropic call against the **real installed SDK typings**, not
against a plausible guess. `output_config.format`, `thinking: {type:
"adaptive"}`, and the beta headers are current API surface because the compiler
said so.

What it does **not** do: prove anything ran. `ScribeASR.transcribe` type-checks
perfectly and has never seen a real response.

### `deno test` — new with SB-010

Added when `_shared/http.ts` grew its first piece of logic that is a pure
function of a `Request` and an env var — no Postgres, no vendor, nothing that
made every other backend behavior a "manual run, logged in
`00-verification.md`" concern instead. `preflight()`'s origin gate (SB-010)
is the first thing here: 5 cases, including a deliberately-missing `Origin`.

**Proven against a real regression, the same discipline as `check-rtl.mjs`:**
the old, unguarded `preflight()` was swapped back in and 3 of 5 tests failed
correctly before the fix was restored — not run once and trusted.

No test-framework import: `assert` helpers are ~5 lines written by hand in
the test file, so `deno test` never needs network access to fetch a package.
This is not (yet) a general pattern for every function — `enrich`/
`transcribe`/`sweep` still call real vendors and a real database, which is
exactly the class of thing this project already refuses to mock (see the
"Vendor API calls" row below). Add a `*.test.ts` here only where the logic
genuinely does not need either.

### `vitest` — 38 tests

Covers `i18n` (including all four Arabic plural categories), language
resolution, and due-date bucketing/counting (`core/due.ts`, SB-050 — the rule
behind the Tasks screen's grouping and the tab badge, kept as pure functions
specifically so it is unit-testable at all). Deliberately narrow otherwise: it
does not test React rendering, because the rendering properties that matter
here (direction, logical property mirroring) are *computed-style* properties
that jsdom does not model faithfully. Those are verified in a real browser
instead — see `docs/00-verification.md` "SB-050" for an example of that split
in practice: the pure rule unit-tested here, the React wiring proven live.

### `check-rtl.mjs` — the guard pattern

Fails the build on physical CSS properties (`margin-left`, `text-align: left`)
that silently break under RTL. **It was tested against a deliberate violation**
and reported both offences before being trusted.

Any guard added later gets the same treatment: write the violation, watch it
fail, delete the violation, watch it pass. A green check that has never been red
is decoration.

## The single command

```bash
cd web && npm run verify      # typecheck + RTL guard + tests + build
```

This is what CI runs and what must be green before any commit.

## What is deliberately not tested automatically

Recorded so nobody mistakes the gap for an oversight.

| Not automated | Why | Covered by |
|---|---|---|
| Vendor API calls | Real keys, real cost, real rate limits | Manual runs, logged in `00-verification.md` |
| Computed styles / direction | jsdom does not model logical properties | Browser verification |
| Offline durability | Needs a real IndexedDB and a real reload | Browser verification |
| iOS behaviour | No emulator tells the truth about Safari | A real device (SB-012) |
| ASR quality | No automated proxy for "is this transcript usable" | Hand-scored WER (SB-013) |

## Live verification — the ledger rule

`docs/00-verification.md` is a record of what **ran**, not what was written.
Rules for editing it:

1. Nothing goes in unless it executed on a machine.
2. Failures go in too. The stranded-`enriching` bug is in there because it was
   found, and that entry is more useful than any passing check.
3. `⬜` and `✅` in `docs/11-features.md` must agree with it.
4. Cost, latency, and quality numbers are **measured**, never estimated. Where
   an estimate exists, it is labelled as one.

## Before a feature counts as done

- [ ] `npm run verify` green
- [ ] `verify.sql` green if the schema moved
- [ ] `deno check` green if a function moved
- [ ] New RLS assertion if a table was added
- [ ] Any new guard proven to fail on a real violation
- [ ] Live behaviour observed once, in a browser or against a real vendor
- [ ] `00-verification.md` updated, including anything that did **not** work
- [ ] `11-features.md` state updated
- [ ] `13-tasks.md` task moved to Done with an evidence pointer

## Gaps in the strategy itself

- **No end-to-end test.** The capture → sync → enrich → search loop is only ever
  verified by hand. A Playwright run against a local stack would be the single
  highest-value test to add.
- **No load or concurrency testing.** Sweep, outbox replay, and rate limiting
  (SB-002) all have concurrency assumptions nobody has stressed.
- ~~**CI has never run on a real runner**~~ **Superseded** — it ran 2026-08-02 and caught a real bug on its first attempt (`docs/00-verification.md`).
