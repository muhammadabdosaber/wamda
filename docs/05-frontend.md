# 5. Frontend — React PWA, RTL + LTR

Vite + React 19 + TypeScript, installable as a PWA. Source in `web/`.

Arabic is the template locale; English is written and type-checked but
disabled.

## Structure

```
web/
  index.html          lang="ar" dir="rtl" in the SERVED markup
  vite.config.ts      PWA manifest + service worker build (injectManifest)
  src/sw.ts           the service worker itself: precache + web push
  src/
    core/language.ts  resolver — mirrors the server
    core/due.ts       due-date bucketing/count — pure, shared by Tasks + badge
    i18n/             ar.ts (TEMPLATE) · en.ts · index.ts (Intl.PluralRules)
    data/             outbox.ts (IndexedDB) · api.ts (+ sync)
    features/         Capture · Notes · Tasks · Search · Digest
    styles/global.css logical properties only
  tool/check-rtl.mjs  CI guard
  test/               38 tests
```

## Direction

`index.html` ships `<html lang="ar" dir="rtl">` in the served markup, not
applied by JavaScript after hydration. If the document started LTR and React
flipped it on mount, every first paint would render left-to-right and visibly
jump — on a slow connection that flash is the first thing the user sees.

`applyDirection()` only changes it when the user later picks another language.

**Both attributes do different jobs.** `dir` drives the CSS logical
properties the entire stylesheet is built on; `lang` drives font selection,
hyphenation, and screen-reader pronunciation. Setting only `dir` gives a
correctly mirrored layout that a screen reader reads out in the wrong
language.

### Logical properties, everywhere

`global.css` contains no `left`, `right`, `margin-left`, `padding-right`, or
`text-align: left`. Every directional value is logical:

| physical | logical |
|---|---|
| `margin-left` | `margin-inline-start` |
| `padding-right` | `padding-inline-end` |
| `left: 0` | `inset-inline-start: 0` |
| `text-align: left` | `text-align: start` |
| `border-left` | `border-inline-start` |

The whole UI mirrors when `dir` flips — no RTL stylesheet, no `[dir=rtl]`
override blocks, no per-component work.

Verified in a live browser: an element with `margin-inline-start: 40px`
computes to `margin-right: 40px` under `dir=rtl` and `margin-left: 40px` under
`dir=ltr`.

### The RTL guard

Stylelint has no rule for this, and `margin-left: 16px` is perfectly valid CSS.
It renders correctly while you develop and pins the margin to the wrong side
the moment `dir` flips. Nothing throws; a screenshot review won't catch it.

`tool/check-rtl.mjs` fails CI on physical properties in both CSS and JSX inline
styles, and names the logical replacement. `rtl-ignore` opts out where a
physical side is genuinely intended (a chart axis that must not mirror).

The guard was itself tested against a deliberate violation — it exits 1 and
reports both offences — because a checker that has only ever passed is not
known to work.

### Note bodies carry their own direction

```tsx
<div dir={directionOfContent(note.detected_language)}>
```

A note's direction comes from the language the *pipeline detected*, not the UI.
In phase 2 an English note inside an Arabic UI must lay out LTR — otherwise its
trailing punctuation jumps to the wrong end and embedded Latin identifiers
reorder. Users report that as corrupted data, not as a layout bug.

## i18n

No i18next. The only non-trivial requirement is correct Arabic plurals, and
`Intl.PluralRules` is built into every target browser. A framework would add a
dependency, a bundle, and an async init step to solve a problem the platform
already solves.

**`ar.ts` is the template.** `en.ts` is typed as `Messages`, derived from it,
so adding a string to Arabic and forgetting it in English is a *compile error*.
Arabic-first enforced by the compiler rather than by discipline.

> One subtlety worth knowing: `Messages` is a mapped type that widens values to
> `string`. Deriving it directly from `typeof ar` (which is `as const`) would
> make every value a literal type and require the English catalogue to equal
> the Arabic text. That was a real compile failure during the build.

### Arabic plurals

Arabic has six CLDR categories against English's two. `n === 1 ? a : b`
produces grammatically wrong Arabic for 2 (dual), 3–10 (few), and 11–99
(many) — which between them cover essentially every count a user sees.

Verified live in the browser:

| count | category | rendered |
|---|---|---|
| 1 | `one` | ملاحظة واحدة بانتظار المزامنة |
| 2 | `two` | ملاحظتان بانتظار المزامنة |
| 3 | `few` | 3 ملاحظات بانتظار المزامنة |
| 11 | `many` | 11 ملاحظة بانتظار المزامنة |

Four distinct forms. A singular/plural pair produces one of them.

### Labels

`categoryLabel()` / `priorityLabel()` / `actionLabel()` map stored **enum
identifiers** to localized text. The database holds `'task'`; the word "مهمة"
exists only in `ar.ts`. That is the client half of the schema's load-bearing
rule.

The `default` arms are not padding — the server can add an enum value before a
client that knows about it has shipped, and an old client must degrade to
"other" rather than render `undefined` in a list. Tested.

## Offline-first capture

`data/outbox.ts` — **a captured thought is durable before any network call is
attempted.**

```
capture → IndexedDB → UI confirms → (later) sync → server
```

IndexedDB rather than localStorage for two reasons that both matter here:
localStorage is synchronous, so it blocks the main thread on the one code path
that must never stutter; and it stores strings only, whereas IndexedDB stores a
`Blob` natively, so a voice recording sits in the outbox as-is instead of being
base64-inflated by a third.

The client mints `clientId` locally, offline. That is the server's idempotency
key — letting the server assign it would turn every retry of an unacknowledged
request into a duplicate note.

`sync()` replays oldest-first and **sequentially**. A burst after a long
offline stretch is exactly the traffic shape that trips per-user rate limits,
and nobody is waiting on the Nth note.

Verified end-to-end in a real browser with no server running: Arabic text typed
into the real textarea → Save clicked → row present in IndexedDB with a UUID
`clientId`, `serverId` undefined, textarea cleared, pending indicator correct.

## Auth

Email OTP — a **six-digit code, not a magic link** — in `features/Auth.tsx`.

That choice is specifically about this being a PWA. A magic link opens in the
default browser, which is a *different context* from the installed standalone
app: the session lands in the browser's storage and the installed app stays
signed out. The user taps the link, sees themselves signed in, returns to the
app icon, and is still on the sign-in screen. A typed code goes into whichever
context asked for it, so it cannot leak across.

This is why `supabase/templates/magic_link.html` exists and is wired up in
`config.toml`: Supabase's default template contains only
`{{ .ConfirmationURL }}`, so without a custom template carrying `{{ .Token }}`
the code field would be unusable in production even though the client is
correct. The template is Arabic and RTL — an email is often the first thing a
new user sees, and a left-aligned Arabic email reads as a broken one.

No password: nothing to remember, nothing to leak, no reset flow to build.

### Capture is never gated

```ts
const REQUIRES_AUTH = new Set<Tab>(["notes", "search", "digest"]);
```

Capture is deliberately absent. Gating it would break the one invariant the
product rests on — a thought must be capturable the instant the user has it,
including before they have ever signed in.

Notes written while signed out sit in the local outbox. `capture_note` defaults
`user_id` to `auth.uid()`, so when a session appears `sync()` attaches them to
whoever signed in, with no reconciliation step and nothing lost. The sign-in
screen says so explicitly (`authCaptureAnyway`), because hitting an
unexplained wall otherwise reads as "your notes are gone".

Verified end-to-end: a note captured while signed out, then a real OTP
sign-in, then both queued notes present in Postgres under the new user.

### Two details that matter more than they look

**The email and code fields are pinned `dir="ltr"`.** Email addresses and
digits are Latin even inside an Arabic UI. Left to inherit RTL, the cursor
starts on the wrong side and `@example.com` visually reorders while typing —
users read that as the app corrupting their input.

**`autoComplete="one-time-code"`** lets iOS and Android surface the code
straight from the notification, removing an app switch at the exact moment a
user is most likely to abandon sign-in.

## PWA specifics, and their honest costs

The manifest carries `lang: "ar"` and `dir: "rtl"`. Without them the OS renders
the installed app's name and splash screen left-to-right regardless of the
page's own direction.

The service worker precaches the app shell so a cold launch works offline. API
responses are deliberately **not** cached — notes live in IndexedDB, which is
queryable and writable offline, and a stale HTTP cache would shadow the local
store and show the user older data than they have on device.

**Since SB-051 the worker is the project's own source file** (`web/src/sw.ts`,
`vite-plugin-pwa` in `injectManifest` mode) rather than one Workbox generates.
Web push is the reason: a `push` listener has to live somewhere, and a
generated worker has nowhere to put one. Two consequences worth knowing before
touching it — the precaching is now this file's responsibility (it does the
same two things `generateSW` did), and the worker gets its own
`tsconfig.worker.json`, because `WebWorker` and `DOM` lib types cannot share a
TypeScript project.

The worker imports the app's own i18n catalogue rather than carrying strings:
the sender transmits counts, and the Arabic sentence is built on the device
from `i18n/ar.ts`. A display label baked into a push message would arrive on a
phone hours after the wording changed.

**Three things a PWA does worse than the native client this replaced:**

1. **Background sync.** `sync()` only runs while a tab is open. A note captured
   offline syncs the next time the user opens the app, not while it is closed.
   The Background Sync API would close the gap on Chromium but is absent on
   Safari, so the app is built to be correct without it.
2. **Voice capture on iOS.** `MediaRecorder` support has historically been
   partial on iOS Safari. `Capture.tsx` feature-detects and shows an honest
   message rather than a button that silently does nothing.
3. **Install friction.** iOS has no install prompt — the user must find
   "Add to Home Screen" in the share sheet. Nothing in the code fixes this.

None of these affect the *durability* invariant, which is the one that matters
most for this user: the thought is saved either way.

## ADHD-oriented decisions

Product requirements, not polish:

- **Capture is the default tab.** The app opens ready to receive. Anything
  between launch and capture is somewhere a thought is lost.
- **The textarea autofocuses.** The default path is "open, type".
- **No category, tag, or folder picker at capture.** Filing is the AI's job.
  Asking the user to file is what makes every other notes app fail this user.
- **AI output is a dismissible suggestion**, never applied silently.
  Auto-filing that guesses wrong destroys trust in everything else.
- **Pending-sync is a quiet line of text, never a red badge.** A badge turns
  "your phone is offline" into something that reads as the user's failure.
- **The weekly digest has no counts, no percentage, no streak.** Those turn a
  review into a scoreboard, and a scoreboard is the thing this user stops
  opening.
- **The language picker renders only once a second language exists**, and each
  option is labelled in its own script — someone who has accidentally set the
  UI to a language they cannot read must be able to find their way back.
