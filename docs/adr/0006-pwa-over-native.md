# 0006. An installable PWA rather than native apps

- **Status:** accepted
- **Date:** 2026-08-01 (recorded retroactively)

## Context

The product is used on a phone, one-handed, often walking, and it needs voice
capture and offline durability. A previous Flutter version was replaced. The
deciding constraint was not reach but **verifiability**: a single developer with
an agent needs every layer to be checkable on the machine where the work happens.

## Decision

One React 19 + Vite PWA, installable on iOS, Android, and desktop. No native
shell.

## Consequences

**Good:** every layer is verifiable locally, and was — computed styles proving
logical properties mirror, IndexedDB read directly after a real button click,
the manifest's Arabic name checked at the code-point level. One codebase, no
store review, deploys are a static build.

**Cost — all of it lands on iOS:**
- **No background sync.** `sync()` runs only while a tab is open, so an offline
  note syncs the next time the app is opened. The Background Sync API would
  close this on Chromium and is absent on Safari, so the app is built to be
  correct without it.
- **`MediaRecorder` on iOS Safari is unverified**, and voice is the fastest
  capture path. The app degrades honestly if recording is unavailable, but that
  is a mitigation, not a fix.
- **IndexedDB eviction** under storage pressure on Safari is unverified, and the
  durability guarantee in ADR-0001 rests on it.
- No install prompt on iOS; "Add to Home Screen" is a manual flow.
- Only Chromium has ever been tested.

## Alternatives considered

**Flutter.** Was the earlier choice and was replaced: too much of it could not
be verified on this machine, and unverifiable code is code that does not work.

**Native iOS.** Fixes background sync and audio, costs a second codebase and a
platform the developer would have to learn well enough to get Arabic RTL right.

**Capacitor/Tauri wrapper.** The likely answer *if* the iOS costs above prove
painful — it keeps this codebase and buys back background capability.

## Revisit if

`MediaRecorder` turns out to be unusable on iOS (SB-012), or the missing
background sync visibly loses notes in daily use. Either result is a concrete
argument for a wrapper, and neither has been measured yet.
