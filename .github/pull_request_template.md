## What and why

<!-- One or two sentences. The consequence, not the activity. -->

Task: SB-0NN <!-- or "none" -->

## What I ran

<!-- Paste real output. "Should work" is not a verification.
     If something was only type-checked, say type-checked — not working. -->

- [ ] `cd web && npm run verify`
- [ ] `verify.sql` → `ALL SCHEMA CHECKS PASSED` (if the schema moved)
- [ ] `deno check supabase/functions/*/index.ts` (if a function moved)
- [ ] Observed working in a browser / against a real vendor

```
paste output here
```

## What I did NOT verify

<!-- Required. There is always something. Silence here reads as a claim. -->

## Rules check

- [ ] No Arabic display text outside `web/src/i18n/` or the email templates
- [ ] No physical CSS properties (`margin-left`, `text-align: left`)
- [ ] No vendor key reachable from the client bundle
- [ ] Every failure path resolves the note status
- [ ] New table → RLS policy **and** `GRANT` **and** an assertion in `verify.sql`
- [ ] Migrations are additive; no applied migration was edited

## Docs

- [ ] `docs/00-verification.md` — what ran, including what failed
- [ ] `docs/11-features.md` — feature state
- [ ] `docs/13-tasks.md` — task status
- [ ] `CHANGELOG.md`
- [ ] ADR added, if the decision is expensive to reverse
