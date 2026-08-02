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
2. Branch: `feat/SB-0NN-short-slug`, `fix/…`, or `docs/…`.
3. Build it, then **run it**. Code that only type-checks is not done.
4. Verify (below), update the docs (below), open a PR.

## Verify

| Changed | Run |
|---|---|
| anything in `web/` | `cd web && npm run verify` |
| a migration | `supabase db reset` then `verify.sql` |
| an Edge Function | `deno check supabase/functions/*/index.ts` |
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

The user has flagged an **unspecified significant design change**
(`docs/09-status-handoff.md`). Several recorded decisions are load-bearing and
would need revisiting if the product shape moves. Ask first.
