# Stitch design export

## ملخّص بالعربي

تصدير من Stitch لتلات شاشات. **بناخد الثيم بس** — الألوان والخطوط
والمسافات. أي حاجة في التصدير بتتعارض مع سلوك اتبنى واتجرّب بالفعل،
بنتجاهلها. الملفات دي مرجع، مش كود يتدمج.

---

Exported from Stitch on 2026-08-03. Three screens, one theme.

```
stitch-export/   Capture   code.html · DESIGN.md · screen.png
notes/           Notes     notes.html · DESIGN.md · screen.png
tasks/           Tasks     tasks.html · DESIGN.md · screen.png
```

The three `DESIGN.md` files are **byte-identical** — one theme across all
three screens, so the tokens cannot disagree.

The `.zip` originals these were extracted from are ignored (`.gitignore`);
the extracted folders are the tracked copy.

## The rule

**Theme only.** Colours, type scale, spacing, radii, and the visual language
of a card. Where the export contradicts behaviour that is already built and
tested, the built behaviour wins.

### Taken

| From the export | Where it lands |
|---|---|
| Colour tokens | `web/src/styles/global.css` |
| Type scale (sizes only — see below) | same |
| Spacing scale, radii | same |
| Task card + checkbox visual language | Tasks screen, when built |
| Muted/grey card treatment | `failed` notes (SB-032) |

### Ignored, and why

| Ignored | Why |
|---|---|
| Tailwind + CDN `<script>`/fonts | The app is an offline-first PWA; a CDN breaks it |
| Plus Jakarta Sans · Inter · JetBrains Mono | None carry Arabic glyphs. The existing Arabic-first stack stays |
| Design line-heights (1.33–1.5) | Arabic diacritics clip. `--line-height: 1.65` stays |
| The floating action button | Decided: not needed |
| Removal of the accept/dismiss buttons on note cards | Deletes a working feature. SB-033 closed by this decision |
| Day-grouping of the notes list | The flat keyset-paginated list stays; grouping is separate work |
| Eastern Arabic numerals (`١٠:٣٠`) | Current output is `10:30 ص` under locale `ar` and is tested. Cosmetic, not theme |
| `rtl:flex-row-reverse` on headers/navs | Double-reverses an already-mirrored flex row — a bug in the export, visible in `screen.png` |
| `right-4`, `pr-12 pl-4`, `left-6`, `left-8` | Physical properties. Everything here is written logical |

`web/tool/check-rtl.mjs` scans `.css`, `.tsx`, `.ts` — not `.html` — so these
files sit here safely. Every physical property above must be converted at the
point it is ported, not carried across.

## Where the prose and the tokens disagree

`DESIGN.md`'s prose names **Muted Sage `#8A9A5B`** as the primary action colour
and **Soft Moss `#A9BA9D`** as secondary. Neither hex appears in its own YAML
front-matter, in any exported `tailwind.config`, or anywhere in the markup. The
prose also gives the background as `#F8F9F7` against the token's `#f9faf8`.

**The tokens are authoritative.** The prose describes a palette that was not
shipped.

Its accessibility claim ("minimum 7:1 for body text") holds for the raw tokens
and fails for the markup, which layers opacity on top of them:

| | Ratio on `#f9faf8` |
|---|---|
| `on-surface` `#191c1b` | 16.40 |
| `on-surface-variant` `#434843` | 8.93 |
| same at `/80` (capture prompt) | 5.12 |
| same at `opacity-70`, 12px (chip labels) | 3.98 |
| nav inactive at `/60` | 3.19 |

The tokens are fine; the opacity modifiers are what break them. Ported without
the opacity.

## Still unanswered

- What a note whose enrichment **failed** renders as. The export's muted
  "مسودة" card supplies the visual language, but that card still has a title
  and a summary — which are exactly what a failed enrichment lacks.
- No dark palette. One is derived in `global.css` from `inverse-primary`
  `#b4cdb8`, which is the token's own dark-mode role.
- No design for the unsynced `PendingCard` ("محفوظة على جهازك").
