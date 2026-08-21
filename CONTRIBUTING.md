# Contributing

Single-developer project with agents doing a large share of the work. These
conventions exist so a fresh session — human or agent — can pick up without
re-deriving anything.

## Setup

```bash
supabase start
supabase db reset

docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
# expect: ALL SCHEMA CHECKS PASSED
```

```bash
cd web
npm install
cp .env.example .env.local     # paste the anon key from `supabase status`
npm run verify
npm run dev
```

Vendor keys go in `supabase/functions/.env` (gitignored) — see
`supabase/functions/.env.example`. Never in the client, never in a commit.

## The loop

1. Take the first unblocked `todo` in `docs/13-tasks.md`.
2. Branch: `feat/SB-0NN-short-slug`, `fix/…`, or `docs/…` (agent sessions use
   `claude/<slug>`; either is fine, never commit to `main` directly).
3. Build it, then **run it**. Code that only type-checks is not done.
4. Verify (below), update the docs (below), open a PR.

**`main` is production.** Cloudflare Pages auto-deploys the PWA on every merge,
against the owner's real notes — there is no staging environment. Migrations
and Edge Functions do *not* ride along: they need `supabase db push` and
`supabase functions deploy <names>` as their own step, and a PR that changes
one should say whether that step has been run.

## Verify

| Changed | Run |
|---|---|
| anything in `web/` | `cd web && npm run verify` — typecheck · RTL guard · 38 tests · build |
| a migration | `supabase db reset` then `verify.sql` — expect 26 assertions, `ALL SCHEMA CHECKS PASSED` |
| an Edge Function | `deno check supabase/functions/*/index.ts` |
| `_shared/*.ts` logic | `deno test --allow-env supabase/functions/_shared/*.test.ts` |
| a new table | all of the above **plus** a new RLS assertion in `verify.sql` |

A new guard is not trusted until it has been made to fail on a deliberate
violation. `check-rtl.mjs` was; yours should be. See `docs/14-testing.md`.

## Rules that are not negotiable

1. **No display label as a key.** Database stores `task`; مهمة lives only in
   `web/src/i18n/ar.ts`.
2. **No physical CSS properties.** Logical only — the RTL guard enforces it.
3. **No vendor key reachable from the client.** `VITE_` is public.
4. **Every failure path resolves the note status.** Optional stages degrade,
   never fail (ADR-0007).
5. **Migrations are additive.** Never edit one that has been applied.
6. **A new table ships with its policy, its grant, and its assertion.**

## Commits

Conventional-ish, imperative, one concern each:

```
feat(sweep): retry stale queued notes with a grace period
fix(enrich): resolve status on the missing-key path
docs(adr): record stage isolation
```

Reference the task id in the body when there is one (`SB-001`).

## Pull requests

Small enough to review in one sitting. The template asks for:

- what changed and why
- **what you ran**, with output — not what you believe works
- what you did not verify
- docs updated

A PR that says "should work" is not ready.

## Documentation is part of the change

| File | Update when |
|---|---|
| `docs/00-verification.md` | anything ran — including if it failed |
| `docs/11-features.md` | a feature's state changed |
| `docs/13-tasks.md` | a task started, finished, or was discovered |
| `docs/adr/` | a decision is expensive to reverse |
| `CHANGELOG.md` | every user-visible or operational change |

The ledger (`00-verification.md`) records what **executed**, never what was
written. Failures belong in it as much as passes.

## Style

- **TypeScript:** strict. No `any` to silence the compiler — fix the type. The
  dual-Vite-identity bug was fixed by matching majors, not by casting.
- **SQL:** one migration per concern, timestamped, with a comment saying why.
  `security invoker` unless there is a stated reason.
- **Arabic text:** only in `web/src/i18n/*.ts` and the email templates.
- **Comments:** explain why. The code says what.
- Match the surrounding voice in docs: short, concrete, honest about gaps.

## Before starting anything large

Read `docs/09-status-handoff.md` first — it names the decisions that are
load-bearing and must not be re-litigated (flat notes, local-first capture,
language as a parameter, PWA over native). The 2026-08-03 redesign has landed
and shipped; the rule it was ported under was **theme only**, and
`docs/design/README.md` is still the contract for any UI work.

Anything that touches authorization — RLS, grants, the service-role gate on
`sweep`/`digest` — gets owner confirmation before it ships. That gate has
already broken its own legitimate caller once (SB-052).
