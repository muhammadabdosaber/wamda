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

## This is live software, not a prototype

Since 2026-08-09 (SB-016) the project runs in production, and the owner uses
it daily on his own phone:

| | |
|---|---|
| PWA | `https://wamda-a8k.pages.dev` — Cloudflare Pages, **auto-deploys on every merge to `main`** |
| Backend | hosted Supabase project `hfjpotjbrrnghuqhxoux` (Postgres 17 + pgvector) |
| Vendor keys | all three real and working on hosted: Anthropic, ElevenLabs, Cohere |
| Scheduled work | five `pg_cron` jobs — sweep `*/5`, digest enqueue/collect, `ai_jobs` purge, `push-due-tasks` (hourly; sends at 08:00 local). A sixth, `push-task-due` (every minute, a reminder at each task's own time), is written (SB-054), not yet on hosted |

Two consequences you must hold onto:

- **Merging to `main` ships to real users' real notes.** There is no staging
  environment. `npm run verify` is the gate, not a formality.
- **A migration or Edge Function is not live until it is pushed.**
  `supabase db push` and `supabase functions deploy <names>` are separate,
  manual steps; only the PWA half deploys itself. Say which half you deployed.

## The six rules that matter most here

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

**6. `sweep`, `digest` and `push` are service-only.**
`requireCronSecret()` (`_shared/http.ts`) compares the bearer to
`CRON_SECRET` — a secret this project owns, not `SUPABASE_SERVICE_ROLE_KEY`,
which Supabase rotated underneath us (SB-052) — and returns `403` otherwise.
The anon key ships in every browser bundle and must not be enough to spend
vendor money. Their only legitimate caller is `pg_cron`, which reads the
secret from Vault at call time (the `*_service_role_key` Vault names are
historical; they hold `CRON_SECRET`). All three carry
`verify_jwt = false` in `supabase/config.toml` (since SB-054) — the platform
gateway rejects a non-JWT bearer before this code runs; with an older CLI,
pass `--no-verify-jwt` too. Deploying them from a branch without this gate brings back the
403 within five minutes; it happened twice (2026-08-17, 2026-10-07).

## Verify before you commit

```bash
cd web && npm run verify
```

typecheck (app **and** the service worker's own WebWorker project) + RTL
guard + 56 tests + build. If the schema moved:

```bash
docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
```

Expect `ALL SCHEMA CHECKS PASSED` — 34 assertions. If a function moved:
`deno check supabase/functions/*/index.ts`. If `_shared/*.ts` logic moved:
`deno test --allow-env supabase/functions/_shared/*.test.ts` (14 tests today:
9 in `http.test.ts`, 5 in `webpush.test.ts`).

**A new table needs an RLS policy, a table-level `GRANT`, and an assertion in
`verify.sql` — in the same change.** Correct policies with no grant produce
`permission denied for table notes`; that was a real bug here.

## Traps that have cost real time

**`cron.job_run_details` lies about success.** It reports `succeeded` when
`pg_net` *queued* the HTTP call, not when the call worked. A scheduled job can
be failing every five minutes for days and look perfectly healthy there. The
truth is one table over:

```sql
select status_code, left(content, 80), created
from net._http_response order by created desc limit 8;
```

That is how SB-052 (hosted sweep/digest rejected with `403` since 2026-08-17)
was found — four days late.

**A new `git worktree` has no vendor keys, even if a real one exists on the
same machine.** `supabase/functions/.env` is gitignored on purpose — it holds
real secrets — so `git worktree` (which only carries tracked files) checks
out without it. This looks exactly like "the key was never obtained" and did
cost real time before being traced: a real `ANTHROPIC_API_KEY` sat unused in
the main checkout while a worktree treated the digest as blocked. Copy the
file from a checkout that has it, then `supabase stop && supabase start`
**from the worktree you copied it into** — a bare restart does not reload
the Edge Runtime's env. Check length before trusting a key
(`grep '^KEY=' .env | cut -d= -f2 | wc -c`) — this repo's placeholders are 3
characters, real keys are 100+.

**The local Edge Runtime serves stale compiled code after an edit**, and
`docker restart supabase_edge_runtime_*` does **not** fix it — the container
demonstrably read the new file while still executing the old version. Only
`supabase stop && supabase start` works. Before debugging a function fix that
"doesn't work", add a distinctive log line and confirm your code is running.

**A hosted symptom is often hosted config, not code.** Production has been
dead twice, both times with the code entirely correct: once with empty
`VITE_` variables on a build that ran before they were saved, once with an
anon key pasted as 200 `•` characters from a masked UI (SB-046). Before
debugging application logic against hosted, confirm what the deployed bundle
actually contains.

**The `main` ruleset matches CI checks by job name, character for character.**
The `database` job is named `… + 31 schema assertions` (there are 34). Renaming
any job in `ci.yml` without updating the ruleset (Settings → Rules → `main`)
leaves it waiting for a check that never reports — every merge blocks.

**Ports are remapped to 54421–54429** (`supabase/config.toml`) because 54322 was
taken by another Supabase project.

**Never write `config.toml` with PowerShell `-Encoding utf8`** — it writes a BOM
and the TOML parser rejects the file.

**Local test user:** `muhammad@example.test`; OTP codes at Mailpit,
`http://127.0.0.1:54424`.

## Layout

```
docs/           design + planning docs · docs/adr/ decision log
  architecture/ generated architecture dashboard (arch-wiki skill)
  design/       the Stitch export — theme only, read its README first
supabase/
  migrations/   schema, RLS, RPCs — additive, never edited in place
  functions/    notes · transcribe · enrich · search · digest · sweep ·
                export · delete-account · push
    _shared/    pipeline.ts is shared by enrich/transcribe/sweep — one copy
  tests/        verify.sql — 34 assertions against a live database
web/            React 19 + Vite PWA
  src/sw.ts     the service worker (push handler) — its own tsconfig, since
                WebWorker and DOM lib types cannot share one project
  src/core/     pure logic, unit-tested without a browser (due dates, clock,
                notification text)
  src/i18n/     the only place Arabic display text is allowed
```

Vendor models, so nobody has to grep for them: enrichment is
`claude-sonnet-5-5` at effort `medium` (`_shared/enrichment.ts`; Opus 5 →
Sonnet 5 in SB-034, → Sonnet 5.5 after a 24-note comparison on 2026-10-21 —
`PRICING` in `pipeline.ts` must change with it), the weekly digest is `claude-opus-5` over the Batch API
(`functions/digest`), transcription is ElevenLabs `scribe_v1`, embeddings are
Cohere `embed-multilingual-v3.0` (1024-dim).

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
5. Say plainly whether the change is **live on hosted** or only on `main` —
   the two are not the same for migrations and Edge Functions.
6. If the decision was expensive to reverse, add an ADR (`docs/adr/template.md`).

## Do not

- Mark a checkbox based on code existing.
- Add a dependency to solve something Postgres already does.
- Edit an applied migration — add a new one.
- Rewrite history in `docs/00-verification.md` or `CHANGELOG.md`. They are
  ledgers: a claim that turned out wrong gets a dated correction underneath
  it, never a silent edit.
- Read or print raw service-role / vendor key material to diagnose something.
  Compare lengths, check `net._http_response`, ask the owner to re-set the
  secret — that boundary is deliberate (SB-052).
- Introduce hierarchy (folders/notebooks/projects) — ADR-0004 is deliberate.
  The Tasks screen is a **filter over notes**, not a container to move them
  into.
- Port anything from `docs/design/` without reading `docs/design/README.md`
  first. The rule is **theme only**: where the export contradicts behaviour
  that is already built and tested, the built behaviour wins. The export
  carries physical CSS properties, Arabic literals in markup, fonts with no
  Arabic glyphs, and no dark palette.
