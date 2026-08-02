// Fails the build on physical (left/right) CSS in a bidirectional app.
//
// Run: node tool/check-rtl.mjs
//
// Why a script and not a lint rule: stylelint has no rule for this out of the
// box, and `margin-left: 16px` is perfectly valid CSS. It renders correctly
// while you develop and pins the margin to the wrong side the moment `dir`
// flips to rtl. Nothing throws, and a screenshot review will not catch it --
// the failure is invisible until an Arabic reader sees it, by which point it
// is spread across a dozen components.
//
// The rule is mechanical, so it belongs in CI rather than in review.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/** physical -> logical */
const BANNED = [
  [/(^|[^-\w])margin-left\s*:/, "margin-inline-start"],
  [/(^|[^-\w])margin-right\s*:/, "margin-inline-end"],
  [/(^|[^-\w])padding-left\s*:/, "padding-inline-start"],
  [/(^|[^-\w])padding-right\s*:/, "padding-inline-end"],
  [/(^|[^-\w])border-left\b/, "border-inline-start"],
  [/(^|[^-\w])border-right\b/, "border-inline-end"],
  [/text-align\s*:\s*(left|right)/, "text-align: start | end"],
  [/float\s*:\s*(left|right)/, "float: inline-start | inline-end"],
  [/(^|[^-\w])(left|right)\s*:\s*(?!auto)/, "inset-inline-start / inset-inline-end"],
  // JSX inline styles
  [/\bmarginLeft\b/, "marginInlineStart"],
  [/\bmarginRight\b/, "marginInlineEnd"],
  [/\bpaddingLeft\b/, "paddingInlineStart"],
  [/\bpaddingRight\b/, "paddingInlineEnd"],
  [/textAlign\s*:\s*["'](left|right)["']/, 'textAlign: "start" | "end"'],
];

const ESCAPE_HATCH = "rtl-ignore";
const EXTENSIONS = new Set([".css", ".tsx", ".ts"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

const violations = [];

for (const file of walk("src")) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.includes(ESCAPE_HATCH)) return;
    // Comments discuss these properties by name (including in this repo's own
    // stylesheet). A checker that flags its own documentation gets disabled
    // within a week.
    const trimmed = line.trimStart();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      return;
    }

    for (const [pattern, replacement] of BANNED) {
      if (pattern.test(line)) {
        violations.push(
          `${file}:${i + 1}\n  use:  ${replacement}\n  line: ${trimmed}`,
        );
      }
    }
  });
}

if (violations.length === 0) {
  console.log("RTL check passed: no physical layout properties in src/.");
  process.exit(0);
}

console.error(`RTL check FAILED -- ${violations.length} physical layout property(ies):\n`);
console.error(violations.join("\n\n"));
console.error(
  `\nThese mirror incorrectly under dir="rtl". Use the logical equivalent, or ` +
    `add a "${ESCAPE_HATCH}" comment on the line if the physical side is genuinely intended.`,
);
process.exit(1);
