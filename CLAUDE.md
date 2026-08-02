# CLAUDE.md

Guidance for Claude Code (and any agent) working in this repository.

## Read first, in this order

1. `docs/09-status-handoff.md` — where things stand, what is blocking
2. `docs/00-verification.md` — what actually **ran**, and what did not
3. `docs/13-tasks.md` — the backlog; take work from here

Then whichever of `docs/01`–`docs/16` covers what you are touching.

## What this project is

Arabic-first capture and recall. Speak or type a thought; AI files it.
Built for a user who thinks in Arabic and has ADHD, so the whole system
optimizes for **the time between deciding to capture and the thought being
durable**. Everything else happens afterwards and can take as long as it needs.

## The five rules that matter most here

**1. Never claim something works until it has run.**
`tsc` passing is not "it works". `deno check` passing is not "it works". The
distinction between `✅ working` and `⬜ built, unrun` in `docs/11-features.md`
is the project's most important convention. Honour it in what you write and in
what you tell the user.

**2. Never store a display label as a key.**
The database stores `task`. The word مهمة exists only in `web/src/i18n/ar.ts`.
An Arabic string in a migration, an Edge Function, or an API response is a bug.

**3. No physical CSS properties.**
`margin-inline-start`, never `margin-left`. `text-align: start`, never `left`.
`web/tool/check-rtl.mjs` fails the build on violations, and it has been proven
to fail on a real one.

**4. Vendor keys never reach the client.**
Anything `VITE_`-prefixed is public. Anthropic, ElevenLabs, and Cohere keys live
only in Edge Function secrets. The client ships the Supabase anon key, which is
safe **only because RLS is correct**.

**5. Every failure path resolves the note's status.**
A note stranded outside a terminal state is invisible to the user and retried by
nobody. Optional stages (embed, relate) degrade the note; they never fail it.
See ADR-0007 — it was written from two real bugs.

## Verify before you commit

```bash
cd web && npm run verify
```

typecheck + RTL guard + 21 tests + build. If the schema moved:

```bash
docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
```

Expect `ALL SCHEMA CHECKS PASSED`. If a function moved:
`deno check supabase/functions/*/index.ts`.

**A new table needs an RLS policy, a table-level `GRANT`, and an assertion in
`verify.sql` — in the same change.** Correct policies with no grant produce
`permission denied for table notes`; that was a real bug here.

## Traps that have cost real time

**The local Edge Runtime serves stale compiled code after an edit**, and
`docker restart supabase_edge_runtime_*` does **not** fix it — the container
demonstrably read the new file while still executing the old version. Only
`supabase stop && supabase start` works. Before debugging a function fix that
"doesn't work", add a distinctive log line and confirm your code is running.

**Ports are remapped to 54421–54429** (`supabase/config.toml`) because 54322 was
taken by another Supabase project.

**Never write `config.toml` with PowerShell `-Encoding utf8`** — it writes a BOM
and the TOML parser rejects the file.

**Local test user:** `muhammad@example.test`; OTP codes at Mailpit,
`http://127.0.0.1:54424`.

## Layout

```
docs/          design + planning docs · docs/adr/ decision log
supabase/
  migrations/  schema, RLS, RPCs — additive, never edited in place
  functions/   notes · transcribe · enrich · search · digest · sweep
    _shared/   pipeline.ts is shared by enrich/transcribe/sweep — one copy
  tests/       verify.sql — assertions against a live database
web/           React 19 + Vite PWA
  src/i18n/    the only place Arabic display text is allowed
```

## Writing style for this repo

The docs have a voice: short, concrete, honest about gaps. Match it.

- State what happened, not what was intended. Failures are recorded too — the
  stranded-`enriching` bug is in the ledger because it was found.
- Cost, latency, and quality numbers are **measured**; label estimates as
  estimates.
- Tables over prose for anything enumerable.
- Key docs open with a short Arabic summary (`## ملخّص بالعربي`) for the user;
  the body stays English. Follow that pattern in new docs.
- Comments explain *why*, and only where the reason is not obvious from the code.

## When you finish a task

1. Update `docs/00-verification.md` with what ran — including what did not.
2. Update the state in `docs/11-features.md`.
3. Move the task to Done in `docs/13-tasks.md` with an evidence pointer.
4. Add a `CHANGELOG.md` entry.
5. If the decision was expensive to reverse, add an ADR (`docs/adr/template.md`).

## Do not

- Mark a checkbox based on code existing.
- Add a dependency to solve something Postgres already does.
- Edit an applied migration — add a new one.
- Introduce hierarchy (folders/notebooks/projects) — ADR-0004 is deliberate.
- Start work against the assumptions in `docs/09-status-handoff.md` before
  asking about **the unspecified design change** the user has flagged.
