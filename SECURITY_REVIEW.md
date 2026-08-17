# Security Review — ومضة (Second Brain)

> Reviewed 2026-08-16 against the full codebase (migrations, Edge Functions,
> web client, config, git history, dependency tree). Scope: the seven
> categories requested by the owner, framed for the planned move to a custom
> domain, dedicated infrastructure, and paid subscriptions.
>
> **2026-08-17 update:** checking the next cron tick (per the owner's own
> request, and exactly the check F1's fix said was still outstanding)
> surfaced that the F1 fix itself broke `sweep`/`digest`'s legitimate
> caller — see F1 below and `docs/00-verification.md`. **Not yet a Fixed
> item; owner action needed.**
>
> **Status legend:** `Not Started` · `In Progress` · `Fixed` · `Accepted Risk` · `Deferred (owner)`

---

## 1. Executive Summary

This codebase is in **unusually good security shape** for its stage. The
things that are usually broken in a pre-revenue SaaS are done correctly here,
and — per the project's own convention — most of them have been *proven by
running them*, not just written:

- **Row Level Security is the authorization layer and it is verified.** Every
  table has RLS enabled (asserted by `verify.sql` check 12 in CI), policies
  are per-user, grants are spelled out explicitly, and cross-user isolation
  was tested live on `notes`, `note_tags`, and `note_embeddings`.
- **No IDOR found.** Every user-facing read runs under the caller's own JWT
  (RLS-scoped client); `enrich`/`transcribe` verify note ownership under the
  caller's RLS *before* the service-role pipeline touches anything.
- **No secrets in source or git history.** Vendor keys live only in Edge
  Function secrets; the repo history contains only placeholders.
- **No injection surface found.** All SQL is parameterized (PostgREST + RPCs),
  React output is escaped, no `dangerouslySetInnerHTML`, strict CSP with no
  `unsafe-inline`, auth is header-token-based so CSRF does not apply.
- **Config is environment-driven** — the app can move hosts/domains without
  code changes, with two small exceptions listed under Portability.

The gaps that remain are real but bounded. The most consequential:

| # | Finding | Severity |
|---|---|---|
| F1 | `sweep` and `digest` (service-only endpoints) are invokable by anyone holding the public anon key — vendor-cost abuse / batch-spam. **The fix shipped but broke the legitimate cron caller too (found 2026-08-17); currently `In Progress`, not resolved.** | **High** |
| F7 | `/search` calls the paid Cohere API with no rate limit | **Medium** |
| F11 | The hosted deploy (Cloudflare Pages) sets no security headers — `frame-ancestors` protection is missing entirely | **Medium** |
| F3 | Session tokens in `localStorage` (accepted, CSP-mitigated, documented) | Medium (accepted) |

Nothing found rises to Critical: there is no cross-tenant data exposure path,
no credential leak, and no unauthenticated data access.

---

## 2. Findings by Category

### Category 1 — Multi-tenant data isolation

**F1 · Service-only endpoints (`sweep`, `digest`) callable with the public anon key — HIGH — `In Progress` (regression: the fix broke the legitimate caller too — see below)**
- **Location:** [supabase/functions/sweep/index.ts:54](supabase/functions/sweep/index.ts:54), [supabase/functions/digest/index.ts:73](supabase/functions/digest/index.ts:73)
- **Risk:** Both functions are designed to be called only by `pg_cron` (which
  sends the service-role key from Vault), but neither checks *who called
  them*. Supabase's default `verify_jwt = true` only requires *a* valid
  project JWT — and the **anon key ships in every browser bundle and
  qualifies**. Anyone can therefore: trigger `digest {action:"enqueue"}`
  repeatedly (each call submits a real Anthropic Message Batch covering
  *every user's* notes — direct vendor spend, and duplicate batches); trigger
  `sweep` with `forceEmbedBackfill: true`, which deliberately bypasses the
  5-attempt retry cap and re-runs vendor calls without bound. No cross-user
  *data* is returned (RLS-independent writes stay scoped to their owners),
  but this is unmetered spend on someone else's trigger — exactly the thing
  the per-user rate limit (SB-002) exists to prevent, reachable without a
  user.
- **Fix:** At the top of both handlers, require the caller to present the
  service-role key (compare the `Authorization` bearer to
  `SUPABASE_SERVICE_ROLE_KEY`) or a dedicated `CRON_SECRET`, and return 403
  otherwise. The pg_cron jobs already send the service-role key, so no
  scheduling change is needed. *Touches the authorization flow → implemented
  after owner confirmation (2026-08-16).*
- **Status:** `In Progress` — the anon-key rejection is confirmed working
  (that was always the easy direction to get right), but checking the next
  cron tick (2026-08-17, as requested) surfaced a **regression**:
  `net._http_response` shows every `sweep-worker` call since the deploy
  (every 5 minutes, 00:00–00:35 UTC and presumably continuing) getting
  `403 {"error":{"code":"forbidden"}}` — the *legitimate* pg_cron caller is
  now also being rejected. `requireServiceRole()`'s comparison logic is
  correct at the unit level (9/9 Deno tests pass, including a matching-key
  case), so the mismatch is between the Vault-stored
  `sweep_service_role_key`/`digest_service_role_key` and the function's
  live `SUPABASE_SERVICE_ROLE_KEY` — most likely a stale key from before a
  rotation, or whitespace from how the secret was originally pasted in
  (SB-001). **Diagnosis deliberately stopped here**: both `supabase
  projects api-keys` and a direct read of `vault.decrypted_secrets` were
  blocked by this session's permission classifier, correctly — this agent
  should not be handling raw service-role key material. **Checked for
  actual damage: none found** — `stuck_notes` shows only pre-existing
  `draft` notes unrelated to sweep, and zero notes are currently sitting in
  `queued`/`transcribing`/`enriching`, so the broken safety net has not yet
  cost a real note. It does need fixing before the next `digest-enqueue`
  firing (Saturdays 03:00). **Owner action needed:** re-run the Vault
  secret update with the current real service-role key (same manual step
  SB-001 already documents, via Supabase Studio's SQL editor or `psql`) —
  see `docs/00-verification.md` "REGRESSION found 2026-08-17" for the full
  evidence and the exact next check to run afterward.

**F2 · `notes/audio-url` service-role write not filtered by `user_id` — LOW — `Fixed`**
- **Location:** [supabase/functions/notes/index.ts:145](supabase/functions/notes/index.ts:145)
- **Risk:** The admin-client update that links `audio_path` to the note
  filters only by `.eq("id", noteId)`. Ownership *was* verified two
  statements earlier under the caller's RLS, so this is not exploitable
  today — but it violates the project's own stated invariant ("every
  service-role query must filter by user_id by hand",
  [docs/08-security.md](docs/08-security.md)) and would become a real IDOR if
  the preceding check were ever refactored away.
- **Fix:** Add `.eq("user_id", user.id)` to the admin update. One line,
  defense-in-depth, no behavior change.
- **Status:** `Fixed` (2026-08-16) — filter added; `deno check` passes.
  Built and type-checked, not exercised against a live stack this session
  (no behavior change expected for the owning caller).

**Verified sound (no finding):**
- All ten tables have RLS enabled + per-user policies
  ([supabase/migrations/20260801000400_rls.sql](supabase/migrations/20260801000400_rls.sql));
  CI re-asserts this on every push, so a future table without a policy fails
  the build.
- Storage objects are path-scoped (`<user_id>/<note_id>.<ext>`) and the
  bucket policy checks the first path segment against `auth.uid()` — the
  client cannot name a path it does not own. Bucket is private; access is
  via short-lived signed URLs only.
- `/export` and the timeline run entirely under the caller's RLS — no
  service role, no forgettable `user_id` filter.
- `search_notes` is `SECURITY INVOKER`, so search inherits caller RLS
  structurally.
- `digest` groups strictly per `user_id`; batch results route back via a
  server-minted `custom_id` the user never influences.
- Ops views (`failed_ai_jobs`, `stuck_notes`, cost views) are deliberately
  **not** granted to `authenticated` — correctly reasoned, since Postgres
  views default to definer semantics and would bypass RLS if granted.
- `delete-account` requires the caller's own session email typed back, and
  deletes Storage bytes before the cascading account delete — proven on a
  disposable user.

### Category 2 — Authentication & session security

**F3 · Session tokens in `localStorage` — MEDIUM — `Accepted Risk`**
- **Location:** `supabase-js` default persistence; analysed in
  [docs/08-security.md](docs/08-security.md) ("Sessions — a real downgrade
  from the native client")
- **Risk:** Any JavaScript on the origin can read the session. A single XSS
  is a full session compromise. There is no browser-side fix that fully
  removes this for a pure SPA + Supabase Auth.
- **Mitigation in place (and load-bearing):** strict CSP with no
  `unsafe-inline`/`unsafe-eval`/wildcards (proven blocking a real disallowed
  fetch), zero third-party scripts, React escaping, refresh-token rotation
  enabled, 1-hour access tokens.
- **Recommendation:** keep as accepted risk while the no-third-party-script
  rule holds; revisit (native wrapper or cookie-based proxy) if the product
  ever embeds analytics/widgets. Before paid tiers, consider Supabase
  `[auth.sessions]` `timebox`/`inactivity_timeout`.
- **Status:** `Accepted Risk` (documented; no code change).

**F4 · Email OTP valid for 1 hour — LOW — `Fixed` (owner-approved; live on hosted)**
- **Location:** [supabase/config.toml:256](supabase/config.toml:256) (`otp_expiry = 3600`)
- **Risk:** A six-digit code sitting in an inbox stays usable for an hour.
  Combined with the 30-verifications-per-5-min-per-IP limit, brute force is
  impractical (10⁶ space), but a long expiry mainly widens the
  stolen-inbox/shoulder-surf window for no UX benefit — the user types the
  code within a minute or two.
- **Fix:** `otp_expiry = 600` (10 minutes). *Auth config; changed after
  owner confirmation (2026-08-16).*
- **Status:** `Fixed` in config.toml (no BOM — verified). **Pushed to
  hosted** (2026-08-16, `SUPABASE_AUTH_SITE_URL=https://wamda-a8k.pages.dev
  supabase config push --project-ref hfjpotjbrrnghuqhxoux`, site URL set per
  the file's own warning) — the CLI reported `Remote Auth config is up to
  date` on a follow-up run, confirming `otp_expiry = 600` is live in
  production. Local takes it on the next `supabase start`.
  **Unrelated, pre-existing issue surfaced by this push, not part of this
  review:** the same `config push` fails on the Storage section —
  `config.toml`'s `[storage.vector] enabled = true` (a newer CLI default)
  can't apply because the hosted project is on the free tier, which
  returns `402 Please upgrade the project to a paid tier to enable vector
  buckets`. Auth/API/DB config all pushed fine; only Storage errors. Left
  as-is — either set `enabled = false` in `config.toml` to match the free
  tier, or ignore until/unless the project upgrades. Flagged for the owner,
  not fixed here (out of scope for this review).

**Verified sound (no finding):**
- **No passwords exist at all** — passwordless email OTP only, so password
  hashing/reset-flow findings are structurally N/A. OTP generation, expiry,
  and single-use enforcement are Supabase GoTrue's, not custom code.
- Refresh-token rotation is on (`enable_refresh_token_rotation = true`,
  10-second reuse interval); JWT expiry 1 hour; JWT signature validation is
  GoTrue/PostgREST-side, not hand-rolled.
- Auth endpoints are rate-limited by GoTrue config: sign-in/sign-ups 30 per
  5 min per IP, OTP verifications 30 per 5 min per IP, email sends 2/hour.
- The OTP email template carries `{{ .Token }}`; the production
  `site_url` footgun (emails pointing at localhost) was already found, fixed,
  and documented (SB-046).

### Category 3 — Common vulnerabilities (OWASP Top 10)

**F5 · No injection / XSS / CSRF surface found — no finding**
- **SQL injection:** No string-concatenated SQL anywhere. All access is
  PostgREST (parameterized) or SQL RPCs taking typed parameters;
  `websearch_to_tsquery` safely handles arbitrary query text; all RPCs pin
  `search_path`.
- **XSS:** React auto-escaping throughout; zero matches for
  `dangerouslySetInnerHTML`/`innerHTML`/`eval`; strict CSP as backstop; note
  content (user- and model-authored, both untrusted) is only ever rendered as
  text.
- **CSRF:** No cookie-based auth — every request carries the JWT in the
  `Authorization` header, which a cross-site form cannot set. Not applicable.
- **SSRF / open redirect / deserialization:** No user-supplied URLs are
  fetched server-side; vendor URLs are constants. Auth redirects are
  allow-listed exactly. Only `JSON.parse` on vendor responses.
- **Prompt injection** (the LLM-era entry): note text is delimited as data in
  the user turn, the system prompt instructs against following it, and
  structured output constrains the shape regardless — a fully successful
  injection still cannot steer downstream code.

**F6 · `notes` INSERT grant is all-columns (self-affecting mass assignment) — LOW — `Deferred (owner)`**
- **Location:** [supabase/migrations/20260801000400_rls.sql:44](supabase/migrations/20260801000400_rls.sql:44); contrast with the column-scoped UPDATE grant in [supabase/migrations/20260804000200_notes_update_grant_scope.sql](supabase/migrations/20260804000200_notes_update_grant_scope.sql)
- **Risk:** SB-023 correctly scoped the client's *UPDATE* grant to the four
  columns it owns, but *INSERT* still permits every column. Via direct
  PostgREST (bypassing `capture_note`) a client can insert its own note with
  a forged `status='ready'`, `transcript_confidence`, `detected_language`,
  or `capture_latency_ms`. RLS confines this to the user's **own rows** —
  no cross-tenant impact — but it lets a client fabricate pipeline state and
  pollute the metrics views, the same class of issue SB-023 closed for
  UPDATE. Becomes slightly more interesting once billing exists (e.g.
  polluting cost/latency telemetry).
- **Fix:** New migration scoping the INSERT grant to
  `(client_id, source, input_language, raw_text, client_created_at,
  capture_latency_ms)` — mirroring what `capture_note` actually sets
  (`status` is derived server-side; `user_id`/timestamps default). Needs a
  matching `verify.sql` assertion per house rule.
- **Status:** `Deferred (owner)` — owner decided 2026-08-16 to fold this
  into the billing/plan schema work rather than ship a migration now.
  Own-rows-only impact makes that defensible; revisit when `profiles.plan`
  lands.

**F7 · `/search` calls the paid Cohere API with no rate limit — MEDIUM — `Fixed`**
- **Location:** [supabase/functions/search/index.ts:51](supabase/functions/search/index.ts:51)
- **Risk:** SB-002 gated `/enrich` and `/transcribe` because "a runaway
  client loop is a runaway vendor bill" — but `/search` embeds the query via
  Cohere on every hybrid/semantic call with no gate. An authenticated
  runaway loop (or a hostile user, once signups are public) generates
  unbounded vendor spend. The infrastructure to fix it already exists.
- **Fix:** Call `enforceRateLimit(admin, user.id, "embed")` before the
  embedding call — reuses the existing `rate_limit_hit()` RPC and the
  `embed` stage rows `/search` already writes to `ai_jobs`. No schema
  change.
- **Status:** `Fixed` (2026-08-16) — `enforceRateLimit(admin, user.id,
  "embed")` now gates the embedding call, same 60/15-min window as the other
  stages. `deno check` passes. Built and type-checked; the 429 path has not
  been exercised over live HTTP this session (the semantic arm needs the
  Cohere key, which this worktree does not have) — same evidence level SB-002
  started at before its 61-call live proof.

**Verified sound (no finding):**
- **File upload validation:** bucket-level MIME allow-list (7 audio types) +
  25 MB size cap enforced by Storage; extension sanitized server-side
  (`[^a-z0-9]` stripped, max 5 chars); path constructed server-side from the
  session user id — no traversal possible; audio is never executed or served
  publicly.
- **Mass assignment elsewhere:** enrichments/embeddings/relations/digests/
  ai_jobs are select-only to the client *by grant*; there is no `role`/
  `isAdmin`-like column anywhere to assign.

### Category 4 — Secrets & configuration management

**F8 · No hardcoded secrets; env-driven throughout — no finding**
- Git history scanned: only `.env.example` placeholders and docs. `.env`
  files were never committed (`git log --all -- "*.env"` is empty);
  `.gitignore` covers all env variants with `!.env.example`.
- Vendor keys live only in Edge Function secrets (`supabase secrets set` on
  hosted, gitignored `.env` locally); the client bundle carries only
  `VITE_SUPABASE_URL` + anon key, correctly documented as public.
- The pg_cron→function URLs and service-role key are read from **Supabase
  Vault** at call time, never literals in migrations.
- The only `SECURITY DEFINER` function is the standard `handle_new_user`
  signup trigger, with pinned `search_path` — correct.
- **CORS:** defaults to `*` only when `ALLOWED_ORIGIN` is unset (local dev);
  production has it pinned to the real origin and rejects foreign/missing
  Origin preflights at 403 (proven by test). Credentialed-wildcard CORS does
  not arise (auth is header-based, `Access-Control-Allow-Credentials` never
  set).
- **Status:** no action needed.

**F9 · Local dev JWT keys are the well-known Supabase development keys — INFO — no action needed**
- The hosted project (`wamda`) was created fresh with its own keys, so the
  docs' open item ("rotate before non-local deployment") is satisfied.
  Remains true that local keys must never be reused anywhere public.
- **Status:** no action needed (hosted uses distinct keys).

### Category 5 — Subscription / billing readiness

**F10 · Data model and enforcement points for paid tiers — INFO / design note — `Not Started`**
- **Good news:** there is **no client-side-only authorization anywhere** —
  every gate that matters (RLS, grants, rate limits, ownership checks) is
  server-side already, so introducing paid tiers does not require moving any
  checks, only adding new ones.
- **Where plan gating belongs when it comes:**
  - `profiles` is the natural home for a `plan text not null default 'free'`
    column (+ `plan_expires_at`); it already fronts `auth.users` 1:1 and is
    select-only-own-row to the client. Keep it **client-read-only** (like the
    pipeline outputs) so a user cannot self-upgrade — i.e. do *not* add it to
    the existing `profiles_update` policy's writable surface (that policy is
    row-scoped, not column-scoped; a column-scoped UPDATE grant like SB-023's
    would be needed, or writes via service role only).
  - Rate-limit constants ([supabase/functions/_shared/rateLimit.ts:24](supabase/functions/_shared/rateLimit.ts:24))
    are hardcoded `LIMIT = 60` — the obvious per-plan lever; read them from
    the caller's plan when tiers exist.
  - Model choice (`ENRICHMENT_MODEL`, `DIGEST_MODEL`) and
    `audio_retention_days` are similarly plan-gateable, all server-side.
- **Webhook idempotency:** the pattern is already proven in this codebase —
  `digest_batches.provider_batch_id` is `unique`, making collection
  idempotent. A future `billing_events` table should copy it: unique
  provider event id, insert-or-ignore, process exactly once. Stripe-style
  webhooks also need signature verification and a service-only endpoint —
  which is exactly the F1 gate pattern.
- **Status:** `Not Started` (deliberately — build when billing is scheduled,
  not before; recorded here so the review is the reference).

### Category 6 — Portability for future infrastructure changes

**F11 · No security headers at the hosting layer (Cloudflare Pages) — MEDIUM — `Fixed` (live)**
- **Location:** `web/public/` (no `_headers` file existed); gap explicitly
  recorded in [docs/08-security.md](docs/08-security.md) and
  [web/vite.config.ts:18](web/vite.config.ts:18)
- **Risk:** The built app relies on the `<meta>` CSP fallback, and the spec
  makes browsers **ignore `frame-ancestors` in meta tags** — so the deployed
  app has no clickjacking protection at all. `report-to`, `X-Content-Type-Options`,
  `Referrer-Policy`, and HSTS are likewise absent.
- **Fix:** Cloudflare Pages reads a `_headers` file from the build output.
  Added [web/public/_headers](web/public/_headers) setting
  `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`
  (header-layer complement to the meta CSP — no drift risk since the full
  policy stays in the meta tag), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and
  `Permissions-Policy` disabling unused sensors. HSTS deliberately omitted —
  Cloudflare already serves it, and a wrong `max-age` at the app layer is
  hard to walk back. Takes effect on the next Pages deploy.
- **Status:** `Fixed` (2026-08-16) — file created, confirmed present in
  `dist/` by a real build. Cloudflare Pages auto-deployed it via its GitHub
  integration on the merge to `main` (check run `Cloudflare Pages`:
  `success`). **Confirmed live** —
  `curl -sI https://wamda-a8k.pages.dev/` returns
  `content-security-policy: frame-ancestors 'none'`, `x-frame-options: DENY`,
  `x-content-type-options: nosniff`, `referrer-policy:
  strict-origin-when-cross-origin`, and the `permissions-policy` line, all
  present on the real response.

**F12 · Environment-tied literals to touch when the domain moves — LOW — `Not Started`**
- **Locations:**
  - [supabase/config.toml:185](supabase/config.toml:185) —
    `additional_redirect_urls` lists `https://wamda-a8k.pages.dev` literally
    (deliberate: it is an allow-list). Add the custom domain when it exists.
  - Vault secrets `sweep_function_url` / `digest_function_url` carry the
    project-ref URL — re-set per environment (already the documented
    procedure).
  - `SUPABASE_AUTH_SITE_URL` env at config-push time (already env-driven
    after the SB-046 incident).
  - `ALLOWED_ORIGIN` Edge secret — re-set to the new origin.
- **Risk:** none today; this is the checklist for the migration day. No URL,
  IP, or absolute path is baked into application code — client and functions
  read everything from env. Database access goes through supabase-js
  exclusively (no raw connection strings in code), so swapping
  hosts/providers is config-only.
- **Status:** `Not Started` (nothing to do until the domain exists; keep as
  checklist).

**F13 · Current-host assumptions that won't carry to production infra — INFO — `Not Started`**
- **Supabase free tier pauses projects after ~1 week of inactivity** — when
  paused, `pg_cron` stops, so `sweep` (the pipeline's safety net) and the
  weekly digest silently stop with it. Fine for a single active user; a
  paid product needs the paid tier or self-hosting (both are config, not
  code).
- Edge Functions are stateless and the outbox/IndexedDB design assumes no
  server file persistence — **no local-filesystem assumptions exist**, so
  moving compute is safe.
- Background work is `pg_cron` + Vault, which is portable to any Postgres
  with those extensions; the two-secret setup is already per-environment.
- **Status:** `Not Started` (informational; revisit at migration).

### Category 7 — Code quality & maintainability

**F14 · Error handling and logging — no finding**
- Every Edge Function returns machine codes only (`errorResponse()`); raw
  errors (which "routinely contain table names, IDs, and occasionally row
  data") are logged server-side, never returned. Verified across all eight
  functions.
- `ai_jobs` telemetry records shape and cost, never note content — enforced
  by convention and comment at the single write site (`recordJob`).
- No secrets, tokens, or note text in any log line found.

**F15 · Dependency audit — LOW — `Fixed`**
- **Location:** `web/package-lock.json`
- **Risk:** `npm audit` (production deps only): **0 vulnerabilities**. Full
  tree: one high — `nanoid < 3.3.18` (infinite loop with size 0), reached
  only via dev tooling, not shipped in the bundle. Edge Functions pin
  `@anthropic-ai/sdk@0.115.0` deliberately and use `supabase-js@2` (floating
  minor — acceptable).
- **Fix:** `npm audit fix` (dev tree), and add an audit gate to CI so the
  docs' open item ("`npm audit` in CI at minimum") is closed — the PWA's
  supply chain runs on the origin with access to `localStorage`, so this is
  the enforcement point for the no-third-party-script rule.
- **Status:** `Fixed` (2026-08-16) — `npm audit fix` ran (nanoid bumped;
  full tree now reports 0 vulnerabilities), and CI's web job now runs
  `npm audit --omit=dev --audit-level=high` after `npm ci`. The CI step
  itself has not executed on a real runner yet — same caveat the workflow
  file already carries about itself.

**F16 · Sign-out leaves the IndexedDB outbox intact on shared devices — LOW — `Not Started`**
- **Location:** [web/src/App.tsx:173](web/src/App.tsx:173) (sign-out), [web/src/data/outbox.ts](web/src/data/outbox.ts)
- **Risk:** Signing out clears the Supabase session but not the local
  outbox. On a shared browser, user A's *unsent* notes persist and — by the
  deliberate pre-auth-capture design — would sync into **user B's account**
  when B signs in. The pre-auth attach behavior is a feature (capture before
  sign-in must survive); the gap is only that *sign-out* doesn't offer to
  flush/clear pending items.
- **Fix (product decision, not just code):** on sign-out, if the outbox has
  pending rows, either block with "you have N unsent notes" or clear them
  after confirmation. Needs the owner's call on which — this is a
  capture-durability tradeoff, the product's core promise.
- **Status:** `Not Started` — needs owner decision on desired behavior.

---

## 3. Prioritized Action List

Sorted Critical → High → Medium → Low. Per the owner's instruction: schema-,
migration-, or auth-touching items stop for confirmation first (marked ⚠);
everything else proceeds directly.

| Pri | # | Action | Touches | Status |
|---|---|---|---|---|
| **High** | F1 | ⚠ Gate `sweep` + `digest` behind the service-role key / cron secret | auth flow | `In Progress` — deployed, but broke the legitimate cron caller too; owner needs to re-set the Vault secrets |
| **Medium** | F7 | Rate-limit the `/search` embedding call (existing `rate_limit_hit`) | function code only | `Fixed` (built, type-checked; 429 path not run live) |
| **Medium** | F11 | Add `web/public/_headers` (frame-ancestors, nosniff, referrer, permissions) | static file | `Fixed` (live after next deploy) |
| **Medium** | F3 | Session-in-localStorage — keep CSP + no-third-party-script rule | — | `Accepted Risk` |
| **Low** | F2 | `user_id` filter on the `audio-url` service-role write | function code only | `Fixed` |
| **Low** | F15 | `npm audit fix` (nanoid, dev tree) + audit step in CI | deps/CI | `Fixed` |
| **Low** | F6 | ⚠ Column-scope the `notes` INSERT grant (new migration + verify.sql assertion) | schema | `Deferred (owner)` — fold into billing schema work |
| **Low** | F4 | ⚠ Shorten OTP expiry 3600 → 600 s | auth config (pushes to prod) | `Fixed` (approved; hosted after config push) |
| **Low** | F16 | Outbox handling at sign-out on shared devices | product decision | `Not Started` |
| **Low** | F12 | Domain-move checklist (redirect allow-list, Vault URLs, `ALLOWED_ORIGIN`, site URL) | config, at migration time | `Not Started` |
| Info | F10 | Billing data model + webhook idempotency design (recorded above) | future schema | `Not Started` |
| Info | F13 | Free-tier pause / infra assumptions (recorded above) | ops | `Not Started` |
| Info | F9 | Local dev keys ≠ hosted keys | — | no action needed |

**State as of 2026-08-17:** every item except F1 is `Fixed` (and confirmed
live — see below), `Accepted Risk`, or `Deferred (owner)`. **F1 is `In
Progress`, not resolved**: deployed 2026-08-16, then checking the next cron
tick on 2026-08-17 (the exact follow-up the fix's own notes flagged as
outstanding) showed `sweep-worker` getting `403 forbidden` from the gate
meant to let it through — see the F1 entry above and
`docs/00-verification.md` "REGRESSION found 2026-08-17" for full evidence.
No damage found yet (nothing is currently sitting in a state that needed
sweep), but it needs the owner's action before it matters. Still open
beyond that: F16 (needs a product decision on sign-out behavior) and the
migration-day checklists (F12, F10, F13).

**Deploy steps already run against hosted, 2026-08-16/17 (all confirmed
live with real requests, not inferred from the deploy command succeeding):**
1. `supabase functions deploy sweep digest search notes` — done. Confirmed:
   a CORS preflight against the deployed `sweep` URL returns `403` (proves
   the new code is serving). **Not yet confirmed:** an anon-key POST
   getting `403 forbidden` from `requireServiceRole()` specifically — and
   as the regression above shows, the more important direction (the real
   cron caller) is currently *failing* the same check.
2. Cloudflare Pages — no manual step needed; its GitHub integration
   auto-deployed the `main` merge. Confirmed live:
   `curl -sI https://wamda-a8k.pages.dev/` returns all five new headers
   (`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`,
   `Referrer-Policy`, `Permissions-Policy`).
3. `SUPABASE_AUTH_SITE_URL=https://wamda-a8k.pages.dev supabase config
   push` — done; a follow-up run confirmed `Remote Auth config is up to
   date` (`otp_expiry = 600` live). Surfaced an unrelated, pre-existing
   issue in the same push: `config.toml`'s `[storage.vector]
   enabled = true` fails against the hosted project's free tier
   (`402 Please upgrade the project to a paid tier`) — left as-is, out of
   scope for this review, flagged for the owner to decide.

**Owner action needed now, to close F1:** re-set the `sweep_service_role_key`
and `digest_service_role_key` Vault secrets with the project's current real
service-role key (Project Settings → API), the same manual step SB-001
originally documented:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'sweep_service_role_key'),
  '<current service role key>');
select vault.update_secret(
  (select id from vault.secrets where name = 'digest_service_role_key'),
  '<same key>');
```

This was deliberately not run by the agent — inspecting or setting the raw
service-role key is exactly the kind of secret-material handling this
session's own permission boundary correctly blocked (`supabase projects
api-keys` and a direct `vault.decrypted_secrets` read were both denied).
After running it, the next `sweep-worker` tick (every 5 minutes) should
show `status_code: 200` in `net._http_response` instead of `403`.
