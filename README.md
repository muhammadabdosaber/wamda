# Second Brain

Arabic-first capture and recall. Speak or type a thought; AI files it so you
don't have to.

Built for a user who thinks in Arabic and has ADHD: a thought has a short
window before it's gone, and any friction inside that window loses it. The
whole system optimizes for the time between deciding to capture and the
thought being durable — everything else happens afterwards and can take as
long as it needs.

English is phase 2. The schema, API, and pipeline are language-parameterized
from day one, so enabling it is a config flag, not a migration.

## Stack

| Layer | Choice |
|---|---|
| Client | React 19 + Vite, installable PWA |
| Backend | Supabase — Postgres 17 + pgvector, Storage, Edge Functions (Deno) |
| Transcription | ElevenLabs Scribe (`scribe_v1`) |
| Enrichment | Claude Sonnet 5, structured outputs + prompt caching (revised down from Opus 5, ADR/SB-034) |
| Weekly review | Claude Opus 5 over the Batch API |
| Embeddings | Cohere `embed-multilingual-v3.0` (1024-dim, cross-lingual) |
| Hosting | Cloudflare Pages (PWA) + hosted Supabase — live since 2026-08-09 |

## Layout

```
docs/           design + planning docs — start with 09-status-handoff.md
  adr/          decision log
  architecture/ generated architecture dashboard (open architecture.html)
.claude/agents/ the agents that continue this work
supabase/
  migrations/   schema, RLS, RPCs
  functions/    notes · transcribe · enrich · search · digest · sweep ·
                export · delete-account
  tests/        verify.sql — 26 assertions against a live database
web/            React PWA client
```

## Run it

```bash
supabase start
supabase db reset

docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
# expect: ALL SCHEMA CHECKS PASSED
```

Vendor keys (server-side only, never in the client bundle):

```bash
supabase secrets set ANTHROPIC_API_KEY=... ELEVENLABS_API_KEY=... COHERE_API_KEY=...
```

Client:

```bash
cd web
npm install
cp .env.example .env.local   # paste the anon key from `supabase status`
npm run verify               # typecheck + RTL guard + 38 tests + build
npm run dev
```

## State

**Live in production since 2026-08-09** (SB-016) — hosted Supabase +
Cloudflare Pages, used daily by its owner on a real phone. Merging to `main`
deploys the PWA automatically; migrations and Edge Functions are pushed
manually.

**Proven by running it, not by reading it:** capture (text and voice) →
ElevenLabs transcription → Claude enrichment → Cohere embeddings →
hybrid search, all against real Arabic notes through a real signed-in
session. The weekly review has produced a real digest from a real Anthropic
Batch call. 38 client tests, 26 schema assertions, 9 Deno tests, RTL guard,
production build 133 KB gzipped — all green on CI runners.

**Known gaps, stated plainly:**

| | |
|---|---|
| **SB-052** — hosted `sweep`/`digest` cron rejected with `403` since 2026-08-17 | the retry safety net is down; needs the owner to re-set a Vault secret |
| **SB-006** — cross-lingual retrieval never tested as its own experiment | the load-bearing assumption behind phase-2 English |
| Android voice capture | untested in either direction (iOS is proven) |
| Safari / Firefox | untested; only Chromium |
| **SB-051** — notifications with the app closed | not built |

`docs/00-verification.md` is the full ledger. Read it before trusting any
claim here — including these.

## Docs

**Product and plan**

| | |
|---|---|
| [09 — Status & handoff](docs/09-status-handoff.md) | **start here**: where things stand and what's blocking |
| [00 — Verification](docs/00-verification.md) | what actually ran, and what didn't |
| [10 — Product spec](docs/10-product-spec.md) | the problem, the principles, the metrics |
| [11 — Features](docs/11-features.md) | every feature, with an honest state |
| [12 — Roadmap](docs/12-roadmap.md) | milestones M0–M7 and their exit criteria |
| [13 — Tasks](docs/13-tasks.md) | the backlog — take work from here |

**Design**

| | |
|---|---|
| [01 — Architecture](docs/01-architecture.md) | shape, and the three decisions behind it |
| [02 — Database schema](docs/02-database-schema.md) | tables, Arabic normalization, indexes |
| [03 — API](docs/03-api.md) | endpoints, language resolution, idempotency |
| [04 — AI pipeline](docs/04-ai-pipeline.md) | six stages, prompt caching, cost |
| [05 — Frontend](docs/05-frontend.md) | RTL/LTR, offline capture, PWA tradeoffs |
| [06 — Integration plan](docs/06-integration-plan.md) | phase order, setup, known risks |
| [07 — Performance](docs/07-performance.md) | budgets and the reasoning behind them |
| [08 — Security](docs/08-security.md) | RLS as the authorization layer |
| [Security review](SECURITY_REVIEW.md) | full-codebase review, per-finding status |
| [Architecture dashboard](docs/architecture/architecture.html) | generated map of modules, endpoints, and infrastructure |
| [ADRs](docs/adr/) | seven decisions, and what each one costs |

**Working on it**

| | |
|---|---|
| [14 — Testing](docs/14-testing.md) | the four layers, and what isn't automated |
| [15 — Runbook](docs/15-runbook.md) | local stack, deploy, and failures that happened |
| [16 — Glossary](docs/16-glossary.md) | domain terms, enum keys, Arabic normalization |
| [CLAUDE.md](CLAUDE.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | conventions, workflow, policy |

## Continuing the work

Two agents are defined in `.claude/agents/`:

| | |
|---|---|
| `second-brain-builder` | takes the next task from `docs/13-tasks.md`, builds it, runs it, records it |
| `second-brain-verifier` | audits claims against reality by running them; may only write to the ledger |

Both read `CLAUDE.md` first — which now opens with the fact that `main` is
wired to production, and what that costs you if you forget it.

## The one idea worth carrying

**Never store a display label as a key.**

The database stores `'task'`. The Arabic word "مهمة" exists only in
`web/src/i18n/ar.ts`. That single rule is why adding English is a new
catalogue rather than a data migration — and why a note filed in Arabic is
still filed correctly when the UI switches language.
