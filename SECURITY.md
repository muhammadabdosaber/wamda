# Security

Design rationale lives in [`docs/08-security.md`](docs/08-security.md). This
file is the policy: how to report something, and what is currently known to be
weak.

## Reporting a vulnerability

Email **eng.mohammadabdo@gmail.com** with a description, reproduction steps, and
what an attacker gets. Please do not open a public issue for anything that
exposes user data.

Or use GitHub's private reporting:
[Report a vulnerability](https://github.com/muhammadabdosaber/wamda/security/advisories/new).

Single-maintainer project — expect a reply in days, not hours.

## The security model in one paragraph

The client ships the Supabase **anon key** and nothing else. Every access path
goes through PostgREST, and **Row Level Security is the authorization layer** —
not defense-in-depth behind an application check. There is no second layer. The
anon key is safe to ship only for as long as RLS is correct, so an RLS mistake
here is a data breach rather than a degraded experience.

Vendor keys (Anthropic, ElevenLabs, Cohere) exist only in Edge Function secrets.
Anything `VITE_`-prefixed is compiled into JavaScript any visitor can read.

## Verified

- Cross-user isolation: user B authenticating and querying user A's note id
  directly returns zero rows — checked independently on `notes`, `note_tags`,
  and `note_embeddings`.
- Every public table has RLS enabled (asserted, so a new table without a policy
  fails the suite).
- `authenticated` has explicit table-level grants — correct policies with a
  missing grant was a real bug here.

Evidence: [`docs/00-verification.md`](docs/00-verification.md).

## Known weaknesses — current, unfixed

The app is **live** (`wamda-a8k.pages.dev`, hosted Supabase, since
2026-08-09), so this list is about production, not about a future deploy.
A full per-finding review is in [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md)
(reviewed 2026-08-16; 0 Critical, 1 High).

| # | Weakness | Impact | Task |
|---|---|---|---|
| 1 | Session tokens in `localStorage` | one XSS is a full session compromise; **accepted risk** — mitigated by a strict CSP with no `unsafe-inline`, and the alternative (httpOnly cookies) is not available to a Supabase JS client | F3 |
| 2 | No CSP violation collector (`report-to`) | violations are visible only in the reporting browser's DevTools; nobody is told | `docs/08-security.md` |
| 3 | `/search` rate limit written but never exercised live | the 429 path is type-checked and unit-covered, not observed under real load | F7 |
| 4 | No structured alerting on pipeline failures | a broken stage is found by someone querying `ai_jobs`, not by being told — which is how the SB-052 `403` went unnoticed for four days, and its 2026-10-07 recurrence for two weeks | SB-019 follow-on |

**Closed since the last revision of this file**, each with evidence in
`docs/00-verification.md`: cron `403` on `sweep`/`digest` → a project-owned
`CRON_SECRET` gate, hosted ticks `200` again since 2026-10-21 (SB-052);
no CSP → strict CSP proven against a deliberate
violation (SB-003); no rate limiting → 60 calls/15 min per user/stage, proven
over 61 real HTTP calls (SB-002); `ALLOWED_ORIGIN: '*'` → foreign preflight
rejected at `403` (SB-010); audio retention unenforced → real Storage bytes
deleted, `400` on re-fetch (SB-009); no account deletion → full cycle proven
across 10 tables (SB-015); no export → `GET /export` proven on real notes
(SB-014); unbounded `ai_jobs` → 90-day purge on a daily `pg_cron` (SB-004);
no host security headers → `frame-ancestors 'none'` confirmed live by `curl`
against the real deployment (F11).

## Handling secrets

- Vendor keys: `supabase secrets set …`; locally `supabase/functions/.env`,
  which is gitignored. Never a `VITE_` variable, never a migration literal.
- Service role key: Vault, read at call time. A migration is a committed file —
  a key in one is a key in the repository forever.
- If a key is ever committed, rotate it at the vendor. Removing the commit is
  not sufficient.

## Scope

Single-user by construction; there is no sharing model and RLS assumes one owner
per row. Reports about multi-user or collaboration scenarios do not apply to the
current design.
