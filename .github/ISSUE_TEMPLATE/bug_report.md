---
name: Bug report
about: Something behaves incorrectly
labels: bug
---

## What happened

## What should have happened

## Repro

1.
2.

## Environment

- Where: local / deployed
- Browser + OS:
- Language: ar / en
- Online or offline:

## Note state, if a note is involved

```sql
select id, status, updated_at from notes where id = '<id>';
select stage, status, error, created_at from ai_jobs
where note_id = '<id>' order by created_at desc;
```

## Checked first

- [ ] The Edge Runtime is running the current code — a fix that "doesn't work"
      is often stale compiled code. `supabase stop && supabase start`
      (`docker restart` does **not** clear it).
- [ ] `docs/00-verification.md` — this path may never have been verified, which
      would make it a gap rather than a regression.
