# 8. Security

## The central fact

The PWA bundle ships the Supabase **anon key**. That key is public by design.
It is safe **only because every table has a correct RLS policy.**

RLS here is not defense-in-depth. It *is* the authorization layer. A table
without a policy is a public table, and a policy that is subtly wrong is a data
breach rather than a bug.

This is why `verify.sql` check 12 asserts that *every* table in `public` has
RLS enabled — the realistic failure is not a wrong policy, it is a table added
six months from now whose policy nobody wrote.

## RLS and GRANTs are two independent gates

Easy to conflate, and conflating them is how this ships broken in one
direction or the other:

- A **policy** says which rows a role may touch.
- A **grant** says whether the role may touch the table at all.

A correct policy with no grant yields `permission denied for table notes`.
That is exactly what the verification suite caught during this build, because
the schema was relying on Supabase's implicit default privileges — which
depend on which role ran the migration and are invisible in review.

Migration `…000400` now spells out every grant. The client's entire capability
surface is one readable list, and the read-only tables are read-only *by grant*,
not merely by convention:

| Table | `authenticated` |
|---|---|
| `notes`, `note_tags`, `tag_labels` | select, insert, update, delete |
| `tags` | select, insert, delete |
| `profiles` | select, update |
| `note_enrichments`, `note_embeddings`, `note_relations`, `weekly_digests`, `ai_jobs` | **select only** |
| `digest_batches` | none |

Pipeline outputs are read-only to the client on purpose. A client that could
write `note_enrichments` could forge AI results; one that could write `ai_jobs`
could rewrite its own cost telemetry.

## Join tables need policies too

Locking down `notes` while leaving `note_tags` open still leaks the shape of
every user's tag graph. `note_embeddings.content` mirrors note text, so its
policy is exactly as sensitive as `notes_select`.

`tag_labels` has no `user_id` of its own; ownership is inherited through
`tags` via an `EXISTS` subquery. Verified: cross-user reads are blocked on
`notes`, `note_tags`, and `note_embeddings` independently.

### A performance note that is also a correctness note

Policies use `(select auth.uid())` rather than a bare `auth.uid()`. The
subselect form is evaluated once per query instead of once per row — the
difference between an index scan and a sequential scan on a large timeline.
A policy slow enough to time out is a policy someone will be tempted to relax.

## service_role

`service_role` bypasses RLS. Every service-role query **must filter by
`user_id` by hand** — the database will not do it for you there.

Used only in Edge Functions, only for writes the user must not be able to
forge. Reads on behalf of a request use the caller's JWT instead, so a leaked
note id still cannot be read cross-user. `functions/enrich` loads the note
under the caller's client *before* the pipeline touches anything.

## Vendor keys

`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `COHERE_API_KEY` live in Edge
Function secrets. They are never in the client bundle, never in the database,
never in a response body, never in a log line.

## Audio

Private bucket. No public URLs, ever. Access exclusively via short-lived signed
URLs.

Ownership is enforced by the path shape: objects live at
`<user_id>/<note_id>.<ext>`, and the storage policy checks
`(storage.foldername(name))[1] = auth.uid()`. The client cannot name a path it
does not own.

Default retention is 30 days (`profiles.audio_retention_days`); the transcript
is the durable artifact, and keeping raw voice recordings indefinitely is
storing sensitive data with no ongoing use.

## Prompt injection

Note content is **data, not instruction**. Two layers:

1. The system prompt states that the note is a transcript of something the user
   said to themselves, and that instruction-like text inside it is ordinary
   content to be classified — never followed.
2. Structured output. Even a fully successful injection cannot make the model
   emit a shape the schema forbids, so downstream code cannot be steered by
   note content.

The note body is delimited in `<note>` tags in the user turn, below the cache
breakpoint — never concatenated into the system prompt.

## Logs and telemetry

`ai_jobs` records stage, status, latency, tokens, cost, and error **code**.
Never note text.

Telemetry tables get queried during incidents by whoever is on call and
exported into dashboards. Note text is the most sensitive data this product
holds; it does not belong on that path.

Error responses carry a machine code. Internal errors are logged server-side
and returned as `internal_error` — stack traces and driver messages routinely
contain table names, IDs, and occasionally row data.

## Sessions — a real downgrade from the native client

Supabase Auth. In a browser, `supabase-js` persists the session in
`localStorage`.

**This is genuinely weaker than the native client it replaced.** A native app
can put tokens in the OS keychain, where another process cannot read them.
There is no browser equivalent: `localStorage` is readable by **any JavaScript
running on the origin**, so a single XSS is a full session compromise. Nothing
in the app's own code fixes that — the mitigation is entirely about ensuring no
foreign JavaScript ever executes on the origin.

What follows from that, and is therefore not optional here:

- **A strict Content-Security-Policy is load-bearing, not hardening.** No
  `unsafe-inline`, no wildcard script sources. On a native client CSP would be
  irrelevant; here it is the primary control protecting the session. **Done**
  (SB-003, 2026-08-06) — see below.
- **Never render note content as HTML.** React escapes by default, and no
  component uses `dangerouslySetInnerHTML`. Note text is user-authored and, for
  voice notes, model-authored — both are untrusted output.
- **Short access-token lifetimes with refresh rotation**, so a stolen token has
  a small window.
- **No third-party scripts on the origin.** Every analytics tag, widget, or CDN
  snippet added later inherits the ability to read the session.

Worth weighing honestly: if this threat model turns out to be unacceptable, it
is an argument for a native wrapper, not for a code change — the ceiling here
is set by the platform.

**SB-003, done 2026-08-06.** `vite.config.ts` builds one CSP from
`VITE_SUPABASE_URL` — no `unsafe-inline`, no `unsafe-eval`, no wildcard —
served as a real header on `vite dev`/`vite preview` and baked as a `<meta>`
fallback into the built HTML. Getting to zero `unsafe-inline` meant moving the
app's only 4 inline `style={{...}}` props to CSS classes. Proven, not just
configured: a real cross-origin auth call succeeded under `connect-src`; a
deliberate `fetch()` to a disallowed origin was blocked and caught by a
`securitypolicyviolation` listener (`main.tsx`) with `disposition: "enforce"`.
`frame-ancestors` and `report-to` cannot live in a `<meta>` tag (spec
limitation) — the served header carries `frame-ancestors 'self'`. **`frame-
ancestors` is closed on hosted**: `web/public/_headers` ships
`frame-ancestors 'none'` (stricter than the app's own `'self'`, on purpose —
Cloudflare Pages serves it at the edge regardless of the meta tag), confirmed
by a real `curl -sI https://wamda-a8k.pages.dev/`, not inferred from the file
existing in `dist/`. **`report-to` is still a real, open gap** — violation
reporting today is `console.error` client-side only, visible in DevTools and
nowhere else; a collector endpoint is real future work, not attempted, and
has no task id yet. Evidence: `docs/00-verification.md`.

## User rights

**Export (SB-014), done 2026-08-07.** `GET /export` returns every note,
enrichment, and tag the caller owns, under the caller's own RLS — no
service role, no `user_id` filter to get wrong. Proven against the owner's
real 14 notes and a fresh cross-user isolation check. See
`docs/00-verification.md` "SB-014/015".

**Delete (SB-015), done 2026-08-07.** `POST /delete-account` requires the
caller's own email typed back exactly, then `auth.admin.deleteUser()`
cascades hard delete from `auth.users` through notes, enrichments,
embeddings, tags, relations, digests, and jobs. Audio is path-scoped per
user and deleted explicitly via the Storage API first (a Postgres FK cannot
reach Storage objects). Proven with a full cycle on a disposable test user:
10 tables to zero, a direct `GET` on the deleted audio object returning
`400`. See `docs/00-verification.md` "SB-014/015".

## Open items before production

- [x] **Per-user rate limit on `/enrich` and `/transcribe`** (SB-002). Gate on
      `ai_jobs` (60 calls / 15 min per user/stage), proven live over real HTTP
      — see `docs/00-verification.md`.
- [x] **Retention for `ai_jobs`** (SB-004, 2026-08-07). 90-day purge, daily
      `pg_cron`, proven live against real inserted rows in `verify.sql`. See
      `docs/02-database-schema.md` and `docs/00-verification.md`.
- [x] **`ALLOWED_ORIGIN` set to a real origin** (SB-010, 2026-08-06). Still
      defaults to `*` locally, by design; when configured, `preflight()` now
      rejects a foreign or missing Origin at `403` instead of only decorating
      the CORS header. Proven with the project's first `deno test`, itself
      proven against a deliberate regression. See `docs/00-verification.md`.
- [x] **Ship a strict CSP header** (SB-003, 2026-08-06). Per the session
      section above — see it for the full evidence.
- [ ] **Subresource integrity / dependency review.** A PWA's supply chain is
      its npm tree, and any package in it runs on the origin with access to
      `localStorage`. `npm audit` in CI at minimum.
- [x] **Verify audio deletion actually runs** (SB-009, 2026-08-07). `sweep`
      now enforces it. Proven with a real upload and a real delete — direct
      `GET` on the removed object returned `400`. See `docs/00-verification.md`.
- [ ] **Rotate the local anon/service keys** before any non-local deployment —
      the ones in `supabase start` output are the well-known development keys.

## Web push (SB-051)

Three things about this feature are security-relevant, and none of them
involve a new secret reaching the client.

**The VAPID pair.** The public half ships in the bundle on purpose -- the
browser needs it to subscribe, and it authorizes nothing by itself. The
private half signs the request to the push service and lives only in an Edge
Function secret. This is the one `VITE_` variable in the project that is
*supposed* to be public, which is exactly why it is called out here: the next
reader should not have to decide whether it is a rule-4 violation.

**The subscription keys are the device's, not ours.** `p256dh` and
`auth_secret` are minted by the browser. They are still worth protecting --
anyone holding them plus the endpoint can push to that device -- so
`push_subscriptions` is RLS-scoped per user, its update grant is column-scoped
(a client may rotate its own keys, not clear the sender's `disabled_at`), and
cross-user reads are asserted in `verify.sql` the same way `notes` is.

**The sender is service-only.** `functions/push` calls
`requireServiceRole()`, and `push_due_candidates()` -- which by design reads
every user's tasks -- is revoked from `authenticated` and granted only to
`service_role`, asserted both ways. Without that, the anon key in every
browser bundle would be enough to make someone else's phone buzz.

What is NOT protected: the push service itself sees the timing and size of
every message (RFC 8291 is explicit about this). The payload is encrypted end
to end -- Google or Apple cannot read the counts -- but the metadata is
theirs. A notification that arrives is a fact about the user's habits, and
this is the first feature in the project that leaks any such fact to a third
party. Recorded here because it is a real, accepted trade, not an oversight.
