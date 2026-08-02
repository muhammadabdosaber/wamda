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

## The four layers

| Layer | Tool | Runs where | Catches |
|---|---|---|---|
| Schema truth | `supabase/tests/verify.sql` | live Postgres | RLS holes, normalization, idempotency |
| Function types | `deno check` | CI | wrong vendor API surface |
| Client units | `vitest` | CI | i18n, plurals, language resolution |
| Client guards | `tool/check-rtl.mjs` | CI | physical CSS properties that break RTL |

Plus the layer no tool covers: **live verification**, recorded by hand in
`docs/00-verification.md`.

## What each layer is actually for

### `verify.sql` — the one that matters most

12 assertions against a real Postgres, not a mock. It exists because the two
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

### `vitest` — 21 tests

Covers `i18n` (including all four Arabic plural categories) and language
resolution. Deliberately narrow: it does not test React rendering, because the
rendering properties that matter here (direction, logical property mirroring)
are *computed-style* properties that jsdom does not model faithfully. Those are
verified in a real browser instead.

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
- **CI has never run on a real runner** — the workflow is new in this change.
