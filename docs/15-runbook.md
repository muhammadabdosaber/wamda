# 15. Runbook

> Operating the thing: local stack, deploy, secrets, and the failures that have
> actually happened on this project rather than the ones that theoretically
> could. Nothing here has run against a hosted project yet — the app has only
> ever existed locally (SB-016).

---

## ملخّص بالعربي

الملف ده للتشغيل والصيانة. أهم حاجة فيه قسم **"لما حاجة تتعطل"** — الأعطال
المكتوبة هناك حصلت فعلًا على المشروع ده، مش أعطال متخيّلة.

أخطر مصيدة: **الـEdge Runtime المحلي بيفضل يشغّل كود قديم بعد ما تعدّل الملف**،
و `docker restart` مش بيحلّها. لازم `supabase stop && supabase start`.

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
| Web dev server | `http://127.0.0.1:5173` |

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

## Deploy (never executed — SB-016)

```bash
supabase link --project-ref <ref>
supabase db push                      # migrations
supabase functions deploy notes transcribe enrich search digest sweep
supabase secrets set ANTHROPIC_API_KEY=... ELEVENLABS_API_KEY=... COHERE_API_KEY=...

cd web && npm run build               # dist/ → any static host, HTTPS required
```

Before the first deploy:

- [ ] `ALLOWED_ORIGIN` pinned to the real origin, not `*` (SB-010)
- [ ] CSP headers configured at the host (SB-003)
- [ ] Rate limits in place (SB-002) — deploying a paid pipeline without them is
      how a bill becomes a story
- [ ] Auth redirect URLs and the OTP email template pointed at the real domain
- [ ] `verify.sql` run against the hosted database, not just the local one

## Scheduled work — currently none

**Nothing is scheduled.** No `pg_cron` job exists in any migration. Both the
sweep worker and the weekly digest are written, and both only ever run when
someone invokes them by hand (SB-001, SB-017).

The shape when it gets built: `pg_cron` calls the deployed function URL through
`pg_net.http_post`, with the service role key read from **Vault**. The key is
never literal in a migration — a migration is a committed file.

## When something breaks

Ordered by how often it has actually happened here.

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

The `sweep` function is the fix, and it currently needs a manual invocation.
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
| Enrichment | Anthropic Opus 5 | **$0.008–0.011 / note** (design estimated $0.015) |
| Transcription | ElevenLabs Scribe | never run |
| Embeddings | Cohere multilingual v3 | never run |
| Digest | Anthropic Batch API | never run |

The one number that can move fast is enrichment, and the guard against it is
per-user rate limiting, which does not exist yet.

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
