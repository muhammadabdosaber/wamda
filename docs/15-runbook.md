# 15. Runbook

> Operating the thing: local stack, deploy, secrets, and the failures that have
> actually happened on this project rather than the ones that theoretically
> could. Hosted since 2026-08-09 (SB-016) — `hfjpotjbrrnghuqhxoux` /
> `wamda-a8k.pages.dev`.

---

## ملخّص بالعربي

الملف ده للتشغيل والصيانة. أهم حاجة فيه قسم **"لما حاجة تتعطل"** — الأعطال
المكتوبة هناك حصلت فعلًا على المشروع ده، مش أعطال متخيّلة.

أخطر مصيدة محلية: **الـEdge Runtime المحلي بيفضل يشغّل كود قديم بعد ما تعدّل
الملف**، و `docker restart` مش بيحلّها. لازم `supabase stop && supabase start`.

**عطل حالي فعليًا شغال دلوقتي (SB-052):** مهام الـcron على الاستضافة
(`sweep`/`digest`) بترفض بـ`403` من ١٧ أغسطس. مفيش ضرر لسه، بس ميعاد الـdigest
الجاي (السبت ٢٢ أغسطس) هياخد نفس الرفض لو محدش صلّحها.

---

## Local stack

```bash
supabase start
supabase db reset

docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
# expect: ALL SCHEMA CHECKS PASSED
```

```bash
cd web && npm install && npm run verify && npm run dev
```

| Thing | Where |
|---|---|
| API | `http://127.0.0.1:54421` |
| Postgres | `127.0.0.1:54422` |
| Studio | `http://127.0.0.1:54423` |
| Mailpit (OTP codes) | `http://127.0.0.1:54424` |
| Web dev server | `http://127.0.0.1:5174` (`.claude/launch.json`) |

**Ports are remapped to 54421–54429** in `supabase/config.toml` because 54322
was taken by another Supabase project on the build machine. If you are not in
that situation, change them — but change them everywhere, including
`web/.env.example`.

**Local test user:** `muhammad@example.test`. Sign in by OTP; read the code in
Mailpit.

## Secrets

Three vendor keys, **server side only**. Anything with a `VITE_` prefix is
compiled into JavaScript any visitor can read — no vendor key ever goes there.

```bash
supabase secrets set ANTHROPIC_API_KEY=...
supabase secrets set ELEVENLABS_API_KEY=...
supabase secrets set COHERE_API_KEY=...
```

Locally: the same three in `supabase/functions/.env` (gitignored — see
`.env.example`), then `supabase functions serve`.

The client gets exactly one credential: the Supabase **anon** key. That is safe
to ship **only because RLS is correct**. If RLS is ever weakened, the anon key
stops being safe on the same day.

## Deploy (done — SB-016, 2026-08-09)

The PWA half deploys itself: Cloudflare Pages' own GitHub integration
auto-deploys `dist/` on every merge to `main`, no manual step. What follows is
the backend half.

```bash
supabase link --project-ref hfjpotjbrrnghuqhxoux
supabase db push                      # migrations
supabase functions deploy notes transcribe enrich search digest sweep delete-account export
supabase secrets set ANTHROPIC_API_KEY=... ELEVENLABS_API_KEY=... COHERE_API_KEY=...

cd web && npm run build               # dist/ → Cloudflare Pages (auto, on push to main)
```

Re-run whichever of these actually changed — `db push` for a new migration,
`functions deploy <name>` for a changed function. Redeploying everything for a
one-file change is unnecessary and, per SB-046, `functions deploy` without a
name list has burned real time before.

Confirmed live at first deploy (still worth re-checking after any change to
the area it covers):

- [x] `ALLOWED_ORIGIN` **set** to the real origin (SB-010) — a foreign preflight
      Origin gets `403` on the real deploy, not just locally
- [x] CSP headers at the host — `frame-ancestors 'none'` confirmed by a real
      `curl -sI https://wamda-a8k.pages.dev/` (`web/public/_headers`,
      Cloudflare's own edge, not the `<meta>` fallback). `report-to` is still
      genuinely absent — no collector exists (`docs/08-security.md`)
- [x] Rate limits in place (SB-002) — proven locally; re-verify against the
      hosted database specifically before relying on it under real traffic
- [x] Auth redirect URLs and the OTP email template point at the real domain —
      required Resend as custom SMTP (the hosted free tier rejects a custom
      template on the default provider); see SB-016's entry in
      `docs/13-tasks.md`
- [ ] `verify.sql` run against the **hosted** database specifically, not just
      local — not yet done as its own step

## Scheduled work — live on hosted, currently broken (SB-052)

Four `pg_cron` jobs exist and were `active: true` as of the SB-016 deploy:
`sweep-worker` (`*/5 * * * *`), `digest-enqueue`/`digest-collect`
(`0 3 * * 6`, weekly), and the `ai_jobs` retention purge (daily). Each calls
its deployed function URL through `pg_net.http_post`, with the service role
key read from **Vault** — never a literal in a migration, since a migration is
a committed file.

**Currently rejected with `403` since 2026-08-17, re-confirmed 2026-08-21 —
see SB-052.** `cron.job_run_details` still shows `succeeded` for every tick
(that layer only confirms pg_net queued the HTTP call), so the failure is
invisible unless `net._http_response` is read directly:

```bash
supabase db query --linked   "select status_code, left(content,80), created from net._http_response
   order by created desc limit 8;"
```

`403 {"error":{"code":"forbidden"}}` on every row means the Vault-stored
service-role key has drifted from the project's real one — the fix is the
owner re-running `vault.create_secret`/`update` with the current key, not a
code change. See SB-052 in `docs/13-tasks.md` for the full trace and the
digest deadline (2026-08-22).

## When something breaks

Ordered by how often it has actually happened here.

### Everything AI-ish stops working at once

Symptom: notes never leave "محفوظة على جهازك", nothing gets classified, no
action chips appear, search returns nothing, and the notes screen reports it
cannot reach the server — all together. That combination is one fault, not
five: **the Edge Runtime is down**, and capture-to-server, enrichment, search
and the timeline all run through it.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:54421/functions/v1/notes
```

`401` is healthy — the endpoint is up and refusing an unauthenticated call.
`503` means the container is gone; check it directly:

```bash
docker ps -a --format "{{.Names}}\t{{.Status}}" | grep edge_runtime
```

**The mount is the usual culprit.** The container binds its functions
directory from wherever `supabase start` was run. If the stack was started
from inside a git worktree and that worktree is later deleted, the mount
source disappears and the container dies with **exit 255** — and it will not
come back, because `supabase start` sees a running stack and skips it, while
`docker start` fails with `error while creating mount source path`. That
happened here.

```bash
supabase stop && supabase start   # from the project root, not a worktree
```

Data survives this: `supabase stop` backs up to a docker volume, and only
`--no-backup` deletes it. Afterwards, confirm the mount is where you expect:

```bash
docker inspect supabase_edge_runtime_Second_Brain --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}'
```

**Start the stack from the project root.** A stack started from a worktree
outlives the reason it was started there.

### A function fix "doesn't work"

**The local Edge Runtime serves stale compiled code after an edit.**
`docker restart supabase_edge_runtime_*` does **not** clear it — the container
was demonstrably reading the new file (confirmed by `grep` inside it) while
still executing the old version.

```bash
supabase stop && supabase start
```

Before debugging logic, add a distinctive log line and confirm the code you are
reading is the code that is running. This costs an hour every time it is
forgotten.

### Notes stuck outside a terminal state

Symptom: a note is invisible in the timeline (which filters `status = 'ready'`)
and nothing retries it.

```sql
select id, status, updated_at from notes
where status in ('transcribing','enriching','queued')
  and updated_at < now() - interval '1 hour';

select * from ai_jobs where note_id = '<id>' order by created_at desc;
```

The `sweep` function is the fix. It is scheduled `*/5` on hosted, but that
schedule is currently rejected with `403` (SB-052), so until the owner re-sets
the Vault secret the only working invocation is a manual one with the service
role key.
Retries are capped at 5 failed attempts per (note, stage), after which the note
is marked `failed` rather than retried forever.

### `permission denied for table notes`

RLS policies can be correct while `authenticated` has no **table-level** grant.
This was a real bug here. Check `GRANT`s, not just policies — `verify.sql`
covers it.

### `prompt_cache_miss` in the logs

Expected exactly once, on the first call after a deploy. If it repeats on every
call, something volatile entered the system prompt (a timestamp, a note id) and
every note is paying full input price instead of ~0.1×.

### `config.toml` rejected by the TOML parser

**Never edit it with PowerShell `-Encoding utf8`** — it writes a BOM.

### Missing embeddings after a `ready` note

By design, not a bug: stages 4–5 are isolated so an embedding failure cannot
lose an enrichment that already succeeded and was paid for. A missing
`note_embeddings` row **is** the backfill marker; `notes_missing_embeddings()`
feeds the sweep.

## Cost

| Stage | Vendor | Measured |
|---|---|---|
| Enrichment | Anthropic Opus 5 → Sonnet 5 (SB-034) | **$0.0094/call cache hit, $0.0220/call cache miss** ($0.018827 average over 11 real notes, `docs/10-product-spec.md`) |
| Transcription | ElevenLabs Scribe | Ran for real (SB-007, confidence 0.925 on a real spoken sentence) — per-call cost not separately measured |
| Embeddings | Cohere multilingual v3 | Ran for real, 14/14 `ready` notes embedded (SB-045) — per-call cost not separately measured |
| Digest | Anthropic Batch API | Ran for real, produced a real digest (SB-018) — cost not separately measured |

The one number that can move fast is enrichment, and the guard against it is
per-user rate limiting: 60 calls / 15 minutes per user per stage, on `/enrich`
and `/transcribe` (SB-002, `docs/00-verification.md`).

## Health checks, when there is something to check

Until SB-019/SB-020 exist, these queries are the monitoring:

```sql
-- stuck notes
select status, count(*) from notes group by status;

-- failures by stage, last 24h
select stage, status, count(*) from ai_jobs
where created_at > now() - interval '24 hours'
group by stage, status;

-- ready notes missing an embedding
-- (the function takes a limit, default 25 — pass a big one when counting,
--  or a count of 25 just means "at least 25")
select count(*) from notes_missing_embeddings(100000);
```
