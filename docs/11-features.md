# 11. Feature Inventory

> Every feature in the product, with an honest state and the file that owns it.
> **State is about what has been observed running**, not about whether code
> exists. Code that has never run is `⬜ built, unrun`, not `✅`.
> Evidence for every `✅` is in `docs/00-verification.md`.

Legend: `✅ working` (observed end to end) · `🟡 partial` (works with a stated
gap) · `⬜ built, unrun` (code complete, never executed) · `❌ not built`

---

## ملخّص بالعربي

الجدول ده بيقول كل مميزة في المنتج، وحالتها الحقيقية.
`✅` معناها اتشغّلت فعلًا واتشافت شغالة. `⬜` معناها الكود متكتب بس عمره ما اشتغل.
الفرق ده مهم: الكود اللي عمره ما اشتغل مش كود شغال.

---

## 1. Capture

| # | Feature | State | Owner |
|---|---|---|---|
| 1.1 | Text capture, Arabic | ✅ | `web/src/features/Capture.tsx` |
| 1.2 | Offline-first write to IndexedDB before any network call | ✅ | `web/src/data/outbox.ts` |
| 1.3 | Client-minted `client_id` as idempotency key | ✅ | `outbox.ts` · `capture_note()` |
| 1.4 | Outbox replay on reconnect / sign-in | ✅ | `outbox.ts` `sync()` |
| 1.5 | Pre-auth capture, attached to whoever signs in | ✅ | verified end to end |
| 1.6 | Retry-attempt accounting, not burned while signed out | ✅ | `outbox.ts` |
| 1.7 | Voice capture via `MediaRecorder` | ✅ two real WebM recordings exist; **Chromium only** | `Capture.tsx` |
| 1.8 | Direct audio upload to Storage under a signed URL | ✅ 173 KB + 8 KB in the `audio` bucket | `functions/notes` |
| 1.9 | Honest degradation when recording is unavailable | ⬜ | `Capture.tsx` |
| 1.10 | Background sync while the app is closed | ❌ | out of scope for PWA — ADR-0006 |
| 1.11 | Saving state, released on the local write | ✅ **95 ms** to on-screen with 8 notes queued | `Capture.tsx` |
| 1.12 | Hand off to the notes tab after a save | ✅ | `App.tsx` |
| 1.13 | Error shown when the local write itself fails | ✅ text kept in the box, message shown | `Capture.tsx` |
| 1.14 | Unsynced notes rendered in the timeline | ✅ verified offline and across a reload | `Notes.tsx` |

## 2. AI pipeline

| # | Feature | State | Owner |
|---|---|---|---|
| 2.1 | Language resolved once at the edge, carried downstream | ✅ | `_shared/language.ts` |
| 2.2 | Enrichment: title, summary, category, priority, action, due date | ✅ run on Opus 5 | `_shared/pipeline.ts` |
| 2.3 | Relative Arabic date resolution ("الخميس" → timestamp, user TZ) | ✅ | verified |
| 2.4 | Tags, slugified so spelling variants converge | ✅ | `slugify()` migration `…000100` |
| 2.5 | Prompt caching (~2.2K cached tokens/call) | ✅ measured | `_shared/providers.ts` |
| 2.6 | `prompt_cache_miss` telemetry signal | ✅ | `functions/enrich` |
| 2.7 | Stage isolation — embedding failure ≠ enrichment failure | ✅ | `_shared/pipeline.ts` |
| 2.8 | Non-terminal state always resolved on failure | ✅ | `pipeline.ts` |
| 2.9 | Refusals resolve to `failed`, not retried forever | ✅ | `pipeline.ts` |
| 2.10 | Transcription via ElevenLabs Scribe | ⬜ **blocked** — stage ran twice, resolved `failed` / `transcription_failed` | `providers.ts` `ScribeASR` |
| 2.11 | Per-word confidence from ASR | ⬜ response shape from docs, never observed | `ScribeASR` |
| 2.12 | Embeddings, Cohere multilingual v3 | ⬜ **blocked** — no key | `providers.ts` |
| 2.13 | `ai_jobs` telemetry per stage | ✅ | migration `…000200` |
| 2.14 | Retry cap (5 failed attempts per note+stage → `failed`) | ✅ | `sweep` |

## 3. Retrieval

| # | Feature | State | Owner |
|---|---|---|---|
| 3.1 | Arabic normalization (alef, haa, tatweel, harakat) | ✅ | migration `…000100` |
| 3.2 | Generated `search_vector`, `arabic` tsconfig | ✅ | migration `…000200` |
| 3.3 | Lexical search across spelling variants | ✅ | `verify.sql` |
| 3.4 | Unenriched notes still findable | ✅ | `verify.sql` |
| 3.5 | Semantic (vector) search arm | ⬜ never run — no embeddings | `functions/search` |
| 3.6 | RRF hybrid fusion of both arms | ⬜ lexical arm only, `p_embedding => null` | migration `…000500` |
| 3.7 | Related notes via nearest neighbour (0.78 threshold) | ⬜ `relate_note()` has never produced a row | migration `…000500` |
| 3.8 | Cross-lingual retrieval (AR query → EN note) | ⬜ **the load-bearing phase-2 assumption** | untested |
| 3.9 | Fusion weights / threshold tuned on a real corpus | ❌ needs ~100 notes | — |

## 4. Client / UX

| # | Feature | State | Owner |
|---|---|---|---|
| 4.1 | Arabic RTL UI, `<html lang="ar" dir="rtl">` | ✅ | `index.html` · `global.css` |
| 4.2 | CSS logical properties mirror correctly | ✅ measured | `global.css` |
| 4.3 | RTL guard in CI (fails on physical properties) | ✅ proven to fail on a violation | `web/tool/check-rtl.mjs` |
| 4.4 | Arabic plurals, all four categories | ✅ | `i18n/index.ts` |
| 4.5 | Enum/label split — DB stores `task`, UI shows مهمة | ✅ | `i18n/ar.ts` |
| 4.6 | Timeline of notes | ✅ | `features/Notes.tsx` |
| 4.7 | Search screen | 🟡 lexical only | `features/Search.tsx` |
| 4.8 | Weekly digest screen | ⬜ | `features/Digest.tsx` |
| 4.9 | Installable PWA, manifest + service worker | 🟡 built and emitted; install flow untested on iOS | `vite.config.ts` |
| 4.10 | Pending-sync indicator | ✅ | `Capture.tsx` |
| 4.11 | Bundled Arabic font | ❌ named in CSS, not shipped — falls back to system face | SB-011 |
| 4.12 | Safari / Firefox support | ⬜ only Chromium tested | — |
| 4.13 | Note detail: raw text next to the AI version | 🟡 verify against `Notes.tsx` before claiming | SB-021 |
| 4.14 | Suggested-action chips do something (accept / dismiss) | ✅ both paths verified against a real database — but see 4.17 | `Notes.tsx` |
| 4.15 | Archive a note for real | ✅ card gone, `archived_at` set, still gone after a reload | `api.ts` `archiveNote` |
| 4.16 | Accepting "أضفها كمهمة" creates a task | ❌ **no destination exists** — the chip only records that you responded | SB-027 |
| 4.17 | A visible result when a suggestion is answered | ❌ two small links vanish, nothing else; **the owner read it as broken** — and the design does not answer it either | SB-033 |
| 4.18 | Design theme from the Stitch export | ✅ tokens verified in a browser, light **and** dark | `global.css` · `docs/design/` |
| 4.19 | Dark mode | ✅ derived palette; filled-button contrast fixed 1.70 → 10.56 | `global.css` |
| 4.20 | Tasks screen | ❌ not built — designed only | SB-036 |

## 5. Auth, data, security

| # | Feature | State | Owner |
|---|---|---|---|
| 5.1 | Email OTP sign-in (6-digit) | ✅ end to end | `features/Auth.tsx` |
| 5.2 | Arabic RTL email template | ✅ | `supabase/templates/magic_link.html` |
| 5.3 | Profile auto-provisioned on signup | ✅ | migration `…000200` trigger |
| 5.4 | RLS on every public table | ✅ 12 checks | migration `…000400` |
| 5.5 | Cross-user isolation on notes/tags/embeddings | ✅ verified independently | `verify.sql` |
| 5.6 | Explicit table grants for `authenticated` | ✅ (was a real bug) | migration `…000400` |
| 5.7 | Vendor keys server-side only | ✅ by construction | — |
| 5.8 | Private audio bucket, signed URLs scoped to user | ⬜ | `config.toml` · `functions/notes` |
| 5.9 | Strict CSP | ❌ **load-bearing** — session is in `localStorage` | SB-003 |
| 5.10 | Per-user rate limits on `/enrich`, `/transcribe` | ❌ a runaway loop is a runaway bill | SB-002 |
| 5.11 | `ALLOWED_ORIGIN` not `*` | ❌ | SB-010 |
| 5.12 | Export all notes | ❌ | SB-014 |
| 5.13 | Delete account + all data | ❌ | SB-015 |
| 5.14 | Audio retention enforcement (`profiles.audio_retention_days`) | ❌ column exists, nothing enforces it | SB-009 |
| 5.15 | `notes.action_dismissed_at` | 🟡 applied to the local database; nowhere else exists yet | migration `20260802000100` |
| 5.16 | Column-scoped update grant on `notes` | ❌ the client can update **any** column, incl. `status` and `raw_text` | SB-023 |

## 6. Operations

| # | Feature | State | Owner |
|---|---|---|---|
| 6.1 | Schema verification harness (12 assertions) | ✅ | `supabase/tests/verify.sql` |
| 6.2 | `npm run verify` — typecheck + RTL + 21 tests + build | ✅ | `web/package.json` |
| 6.3 | Sweep worker: unstick, retry, backfill embeddings | 🟡 verified locally; **nothing schedules it** | `functions/sweep` · SB-001 |
| 6.4 | Weekly digest, Batch API + structured outputs | ⬜ written, never executed | `functions/digest` |
| 6.5 | `pg_cron` schedule for sweep | 🟡 on `main`; applies cleanly in CI and takes its `NOTICE` path. **Nothing has ever swept** — needs Vault secrets | SB-001 |
| 6.5b | `pg_cron` schedule for digest | ❌ nothing written | SB-017 |
| 6.6 | CI pipeline | ✅ all three jobs green on a real runner; the 12 assertions ran against a real Postgres | `.github/workflows/ci.yml` |
| 6.7 | `ai_jobs` retention / partitioning | ❌ grows without limit | SB-004 |
| 6.8 | Structured logging / alerting | ❌ | SB-019 |
| 6.9 | Product analytics for the success metrics | ❌ | SB-020 |
| 6.10 | Staging / production deployment | ❌ local only, never deployed | SB-016 |

## 7. Phase 2 — English

| # | Feature | State |
|---|---|---|
| 7.1 | `en` defined and wired through every seam | ✅ by construction — seven seams, ADR-0002 |
| 7.2 | `web/src/i18n/en.ts` written and type-checked | ✅ |
| 7.3 | `normalize_latin` / `ts_config_for('en')` | ✅ in the schema |
| 7.4 | `en.enabled = true` flip | ❌ deliberately off |
| 7.5 | Language picker (appears once >1 language is enabled) | ⬜ |
| 7.6 | Mixed-language screen rendered with real content | ⬜ mechanism proven, screen never rendered |

## Totals

| State | Count |
|---|---|
| ✅ working | 44 |
| 🟡 partial | 6 |
| ⬜ built, unrun | 18 |
| ❌ not built | 20 |

The 20 in `⬜` are the honest headline, and most of them unblock with one API
key: **Cohere**. Enrichment has now run 42 times against a real Anthropic key
in a single session, with every embedding call failing beside it — which is
the clearest demonstration yet that stage isolation (ADR-0007) holds.
