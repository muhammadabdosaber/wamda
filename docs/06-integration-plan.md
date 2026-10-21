# 6. Integration Plan

## Status

| Phase | Work | State |
|---|---|---|
| 0 | Schema, RLS, migrations, verification harness | **done, verified** |
| 0 | Edge Functions, all eight | **done, type-checked** |
| 0 | React PWA: i18n, RTL, offline outbox, PWA shell | **done, verified in a browser** |
| 1 | Auth (email OTP) + capture against a running Supabase | **done, verified end to end** |
| 2 | Enrichment + embeddings with live API keys | **done** — real Sonnet 5 output, semantic search live (SB-005) |
| 3 | Voice path on a real phone | **done on iOS** — real transcription end to end on hosted (SB-007); Android untested |
| 4 | Hybrid search tuning on a real corpus | later — needs ~100 notes |
| 5 | Weekly digest via cron + Batch | **done, run for real** (SB-017/018); hosted cron was blocked by SB-052 2026-08-17 → 2026-08-22, now fixed and confirmed live |
| 6 | Rate limits, CSP, export/delete, hosted deploy | **done** (SB-002/003/010/014/015/016) |
| 7 | **English** | later — gated on SB-006 (cross-lingual test), not on a key |

Phase 0 is complete on both sides, and so is everything through phase 6. The
the one operational issue that existed (SB-052, hosted cron rejected 2026-08-17 → 2026-08-22) is now fixed and confirmed live — see `docs/13-tasks.md` and `docs/00-verification.md`.

## Getting it running

### Backend

```bash
supabase start
supabase db reset

docker exec -i supabase_db_Second_Brain \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/verify.sql
# expect: ALL SCHEMA CHECKS PASSED
```

> The local stack in this repo is remapped to ports **54421–54429**
> (`supabase/config.toml`) because 54322 was already taken by another Supabase
> project on the build machine. Adjust if that is not your situation.

### Secrets

Three vendor keys, server-side only:

```bash
supabase secrets set ANTHROPIC_API_KEY=...
supabase secrets set ELEVENLABS_API_KEY=...
supabase secrets set COHERE_API_KEY=...
```

Locally, the same three in `supabase/functions/.env` (gitignored), then:

```bash
supabase functions serve
```

### Client

```bash
cd web
npm install
cp .env.example .env.local        # then paste the anon key from `supabase status`
npm run verify                    # typecheck + RTL guard + tests + build
npm run dev
```

`npm run verify` is the single command CI should run. It currently passes:
typecheck clean, 38 tests, RTL guard clean, production build.

**The Arabic font is bundled (SB-011).** Public Sans (Latin) paired with
self-hosted Noto Sans Arabic, split by `unicode-range`, no CDN `<link>` — this
line used to flag a gap that no longer exists.

## Phase order, and why

**Phase 1 before 2.** Get a text note surviving offline → reconnect against a
real server before adding any AI. Offline correctness is the hardest thing to
retrofit, and every later stage sits on top of it. The client half of this is
already proven; what remains is the round trip.

**Phase 2 before 3.** Enrichment against typed Arabic text isolates prompt and
schema problems from ASR problems. Debugging both at once means you cannot tell
a bad summary from a bad transcript.

**Phase 3 needs a real phone.** Two separate unknowns: ASR quality on your
dialect, and whether `MediaRecorder` behaves on iOS Safari. Test on the actual
device, not a desktop browser.

**Phase 4 needs a real corpus.** Tuning the RRF fusion or the 0.78 relation
threshold against three test notes tells you nothing. Wait for ~100 real notes.

## Known risks

**ASR quality on your dialect.** ElevenLabs Scribe was chosen on published
Arabic WER, but no benchmark substitutes for your voice, your accent, and your
background noise. If it disappoints, `ASRProvider` is one interface with one
implementation — Azure AI Speech has `ar-AE` dialect models.

**iOS is where the PWA bet gets tested.** Three things to check on a real
iPhone before committing: `MediaRecorder` availability for voice capture,
whether IndexedDB survives Safari's storage eviction under pressure, and the
"Add to Home Screen" flow (iOS has no install prompt). The app degrades
honestly if recording is unavailable, but that is a mitigation, not a fix.

**No background sync.** `sync()` runs only while a tab is open. An offline note
syncs the next time the user opens the app. Background Sync API would close the
gap on Chromium but is absent on Safari, so the app is built to be correct
without it. If this proves painful, it is an argument for a native wrapper.

**Session storage.** `localStorage` is XSS-readable — see the session section
in `docs/08-security.md`. A strict CSP is not optional here.

**The `arabic` snowball stemmer is decent, not excellent.** It handles MSA
morphology reasonably and dialectal Arabic less well. Mitigated rather than
solved: the semantic arm of hybrid search covers what the lexical arm misses.

**Prompt cache stability.** The cost model assumes a cache hit on every note
after the first. `functions/enrich` logs `prompt_cache_miss` — watch it during
phase 2. A permanent warning means something volatile entered the system prompt
and every note is paying full price.

**Batch API + structured outputs.** The digest path requests JSON by prompt
rather than by schema. Run for real (SB-018): the model wraps its JSON in a
code fence, which broke the naive parse on the first real Batch response —
found and fixed, not a hypothetical. The fallback (keep the prose rather than
drop a week's review on a parse failure) has not itself been exercised, since
the parse now succeeds.

## Phase 7 — English

The point of everything above. To enable English:

1. `en.enabled = true` in `supabase/functions/_shared/language.ts`
2. the same flag in `web/src/core/language.ts`
3. `web/src/i18n/en.ts` — already written and type-checked

No migration. No backfill. No new tables. `note_enrichments` and
`note_embeddings` gain rows; `ts_config_for` already returns `english`;
`normalize_latin` already exists; the language picker appears automatically
once `enabledTags()` returns more than one; note bodies already set their own
`dir` from the detected language.

Two things to verify rather than assume:

- **Cross-lingual retrieval.** Cohere embed-multilingual-v3.0 should let an
  Arabic query find an English note. Test with a real pair before announcing it.
- **The RTL→LTR switch on a populated screen.** The mechanism is proven
  (logical properties mirror correctly), but no screen has been rendered with
  real mixed-language content in it.
