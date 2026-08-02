# Security

Design rationale lives in [`docs/08-security.md`](docs/08-security.md). This
file is the policy: how to report something, and what is currently known to be
weak.

## Reporting a vulnerability

Email **eng.mohammadabdo@gmail.com** with a description, reproduction steps, and
what an attacker gets. Please do not open a public issue for anything that
exposes user data.

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

Stated plainly because the project has never been deployed and these must not be
discovered after it is.

| # | Weakness | Impact | Task |
|---|---|---|---|
| 1 | **No CSP.** `supabase-js` keeps the session in `localStorage` | one XSS is a full session compromise | SB-003 |
| 2 | **No rate limiting** on `/enrich` and `/transcribe` | a runaway loop is a runaway vendor bill | SB-002 |
| 3 | `ALLOWED_ORIGIN` defaults to `*` | any origin can call the functions | SB-010 |
| 4 | **Audio retention not enforced** — `profiles.audio_retention_days` is read by nothing | voice kept longer than promised | SB-009 |
| 5 | No account deletion | a user cannot remove their data | SB-015 |
| 6 | No export | a user cannot retrieve their data | SB-014 |
| 7 | `ai_jobs` grows without limit | unbounded retention of processing metadata | SB-004 |

Items 1–3 must be closed **before any public deployment** (M6 in
[`docs/12-roadmap.md`](docs/12-roadmap.md)).

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
